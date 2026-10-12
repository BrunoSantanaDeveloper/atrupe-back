import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from 'nestjs-prisma';
import { FilterEmployeeDto } from './dto/filter-employee.dto';
import { Prisma } from '@prisma/client';
import { EmployeeHistoryService } from './history/history.service';
import { PlanControlService } from '../plan/plan-control.service';
import { assertBelongsToCompany } from 'src/shared/tenant/company-scope';

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historyService: EmployeeHistoryService,
    private readonly planControl: PlanControlService,
  ) {}

  /**
   * O cargo decide as permissões e o administrador do usuário: com o cargo
   * de outra empresa, quem controla o acesso do colaborador passava a ser
   * ela. O setor também precisa ser da empresa.
   */
  private async assertRoleAndSectorOfCompany(
    companyId: string,
    roleId: string | null | undefined,
    sectorId: string | null | undefined,
  ) {
    await assertBelongsToCompany(
      this.prisma.role,
      roleId,
      { companyId },
      'Cargo não encontrado.',
    );
    await assertBelongsToCompany(
      this.prisma.companySector,
      sectorId,
      { companyId },
      'Setor não encontrado.',
    );
  }

  async create(
    createEmployeeDto: CreateEmployeeDto,
    userId?: string,
    userName?: string,
  ) {
    await this.assertRoleAndSectorOfCompany(
      createEmployeeDto.companyId,
      createEmployeeDto.roleId,
      createEmployeeDto.sectorId,
    );

    try {
      return this.prisma.$transaction(async (tx) => {
        // 1. Criar o employee
        const employee = await tx.employee.create({
          data: {
            name: createEmployeeDto.name,
            avatarUrl: createEmployeeDto.avatarUrl ?? null,
            signatureUrl: createEmployeeDto.signatureUrl ?? null,
            role: {
              connect: {
                id: createEmployeeDto.roleId,
              },
            },
            sector: {
              connect: {
                id: createEmployeeDto.sectorId,
              },
            },
            company: {
              connect: {
                id: createEmployeeDto.companyId,
              },
            },
          },
        });

        // 2. Buscar todos os templates da empresa
        const templates = await tx.payrollTemplate.findMany({
          where: { companyId: createEmployeeDto.companyId },
        });

        // 3. Criar payroll setups baseados nos templates
        if (templates.length > 0) {
          await Promise.all(
            templates.map(async (template) => {
              await tx.payrollSetup.create({
                data: {
                  name: template.name,
                  type: template.type,
                  amount: template.defaultAmount || 0,
                  isSet: true,
                  companyId: createEmployeeDto.companyId,
                  employeeId: employee.id,
                  templateId: template.id,
                },
              });
            }),
          );
        }

        // 4. Registrar no histórico
        if (userId) {
          await this.historyService.createEmployeeHistory({
            employeeId: employee.id,
            action: 'CREATE',
            description: this.historyService.getCreateDescription(
              employee.name || 'Sem nome',
            ),
            metadata: {
              roleId: createEmployeeDto.roleId,
              sectorId: createEmployeeDto.sectorId,
            },
            createdBy: userId,
            createdByName: userName,
          });
        }

        return employee;
      });
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async findAllQuantity(companyId: string) {
    const result = await this.prisma.employee.groupBy({
      by: ['isActive'],
      where: { companyId },
      _count: {
        _all: true,
      },
    });

    // Inicializa os contadores com zero
    const statusCount = {
      actives: 0,
      inactives: 0,
    };

    // Mapeia os resultados para os contadores
    result.forEach((cur) => {
      if (cur.isActive) {
        statusCount.actives = cur._count._all;
      } else {
        statusCount.inactives = cur._count._all;
      }
    });

    // Calcula o total
    const total = statusCount.actives + statusCount.inactives;

    // Cota de usuários do plano: quem tem acesso (a mesma conta do limite) e
    // o limite, já com os usuários adicionais. -1 = ilimitado; nulo = o
    // plano não limita ou a empresa está sem assinatura ativa.
    const [used, planInfo] = companyId
      ? await Promise.all([
          this.planControl.getCurrentUserCount(companyId),
          this.planControl.getCompanyPlanInfo(companyId),
        ])
      : [0, null];

    return {
      ACTIVES: statusCount.actives,
      INACTIVES: statusCount.inactives,
      TOTAL: total,
      USERS: { used, limit: planInfo?.limits.max_users ?? null },
    };
  }

  async findAllFlat(filter: FilterEmployeeDto) {
    try {
      const where: Prisma.EmployeeWhereInput = {
        companyId: filter.companyId,
      };

      if (filter.search) {
        where.name = {
          contains: filter.search,
          mode: 'insensitive',
        };
      }

      if (filter.sectorId) {
        where.sectorId = filter.sectorId;
      }

      if (filter.isActive !== undefined) {
        where.isActive = filter.isActive;
      }

      if (filter.status) {
        where.isActive = filter.status === 'ACTIVE';
      }

      // Configurar ordenação
      let orderBy = {};
      if (filter.orderBy) {
        orderBy = {
          [filter.orderBy]: filter.orderDirection || 'asc',
        };
      } else {
        // Ordenação padrão por nome (crescente)
        orderBy = {
          name: 'asc',
        };
      }

      const [total, employees] = await Promise.all([
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
              },
            },
            address: true,
            role: true,
            sector: true,
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: orderBy,
        }),
      ]);

      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
        lastPage,
        data: employees,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async findAll(filter: FilterEmployeeDto) {
    try {
      const where: Prisma.EmployeeWhereInput = {
        companyId: filter.companyId,
      };

      if (filter.search) {
        where.name = {
          contains: filter.search,
          mode: 'insensitive',
        };
      }

      if (filter.sectorId) {
        where.sectorId = filter.sectorId;
      }

      if (filter.isActive !== undefined) {
        where.isActive = filter.isActive;
      }

      if (filter.status) {
        where.isActive = filter.status === 'ACTIVE';
      }

      // Configurar ordenação
      let orderBy = {};
      if (filter.orderBy) {
        orderBy = {
          [filter.orderBy]: filter.orderDirection || 'asc',
        };
      } else {
        // Ordenação padrão por nome (crescente)
        orderBy = {
          name: 'asc',
        };
      }

      const [total, employees, company] = await Promise.all([
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
              },
            },
            address: true,
            role: true,
            sector: true,
          },
          take: +filter.limit,
          skip: (+filter.page - 1) * +filter.limit,
          orderBy: orderBy,
        }),
        this.prisma.company.findUnique({
          where: { id: filter.companyId },
          select: { ownerUserId: true },
        }),
      ]);

      // O titular é marcado na listagem: é quem responde pela conta (e o
      // único que transfere a titularidade ou cancela a assinatura).
      const ownerUserId = company?.ownerUserId ?? null;

      const groupedBySector = employees.reduce(
        (acc, employee) => {
          const sectorId = employee.sector?.id || 'no-sector'; // Agrupar os sem setor na chave 'no-sector'

          if (!acc[sectorId]) {
            acc[sectorId] = {
              sector: employee.sector
                ? employee.sector
                : { id: 'no-sector', name: 'Sem Setor' },
              employees: [],
            };
          }
          acc[sectorId].employees.push({
            ...employee,
            isOwner: !!employee.userId && employee.userId === ownerUserId,
          });

          return acc;
        },
        {} as {
          [key: string]: {
            sector: { id: string; name: string };
            employees: any[];
          };
        },
      );

      // Organizar a resposta para garantir que "Sem Setor" apareça por último
      const result = Object.values(groupedBySector).sort((a, b) => {
        // Garantir que 'a' e 'b' tenham a propriedade 'sector' corretamente tipada
        if (a.sector.name === 'Sem Setor') return 1;
        if (b.sector.name === 'Sem Setor') return -1;
        return 0;
      });
      const lastPage = Math.ceil(total / +filter.limit);

      return {
        total,
        lastPage,
        data: result,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  findOne(id: number) {
    return `This action returns a #${id} employee`;
  }

  /**
   * O colaborador do titular da conta não é inativado nem deixa de ser
   * administrador: a titularidade sai só por transferência, e o titular é
   * administrador em tudo que administradores fazem.
   */
  private async assertOwnerStays(
    tx: Prisma.TransactionClient,
    id: string,
    change: { deactivating: boolean; roleId?: string | null },
  ) {
    const employee = await tx.employee.findUnique({
      where: { id },
      select: { userId: true, company: { select: { ownerUserId: true } } },
    });
    const ownerUserId = employee?.company?.ownerUserId;
    if (!employee?.userId || !ownerUserId || employee.userId !== ownerUserId) {
      return;
    }

    if (change.deactivating) {
      throw new UnprocessableEntityException({
        code: 'OWNER_CANNOT_BE_DEACTIVATED',
        message:
          'Este colaborador é o titular da conta e não pode ser inativado. Para isso, transfira a titularidade antes.',
      });
    }
    if (change.roleId !== undefined) {
      const role = change.roleId
        ? await tx.role.findUnique({
            where: { id: change.roleId },
            select: { isAdmin: true },
          })
        : null;
      if (!role?.isAdmin) {
        throw new UnprocessableEntityException({
          code: 'OWNER_MUST_BE_ADMIN',
          message:
            'O titular da conta é sempre administrador. Para mudar o cargo dele, transfira a titularidade antes.',
        });
      }
    }
  }

  async update(
    id: string,
    updateEmployeeDto: UpdateEmployeeDto,
    userId?: string,
    userName?: string,
  ) {
    const { isActive, address, ...rest } = updateEmployeeDto;

    if (rest.roleId || rest.sectorId) {
      const current = await this.prisma.employee.findUnique({
        where: { id },
        select: { companyId: true },
      });
      // Sem o colaborador, o fluxo abaixo responde como sempre
      if (current) {
        await this.assertRoleAndSectorOfCompany(
          current.companyId,
          rest.roleId,
          rest.sectorId,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnerStays(tx, id, {
        deactivating: isActive === false,
        roleId: rest.roleId,
      });

      // Capturar estado antes da atualização
      // IMPORTANTE: Ao adicionar novos campos editáveis no Employee,
      // inclua-os neste select para que sejam rastreados no histórico
      const employeeBefore = await tx.employee.findUnique({
        where: { id },
        select: {
          name: true,
          isActive: true,
          roleId: true,
          sectorId: true,
          avatarUrl: true,
          signatureUrl: true,
          sallary: true,
          cpf: true,
          mobile: true,
          phone: true,
          rg: true,
        },
      });

      // Atualiza os dados do Employee
      const employeeUpdate = await tx.employee.update({
        where: { id },
        data: {
          ...rest,
          isActive,
        },
      });

      // Verifica se o campo isActive foi enviado
      if (isActive !== undefined) {
        const employee = await tx.employee.findUnique({
          where: { id },
          select: { userId: true },
        });

        // Desativa o usuário associado se isActive for false
        if (!isActive && employee?.userId) {
          await tx.user.update({
            where: { id: employee.userId },
            data: { isActive: false },
          });
        }
      }

      // Gerenciamento de endereços
      if (address) {
        // Verifica se o Employee já possui endereços associados
        const existingAddresses = await tx.address.findMany({
          where: { employeeId: id },
        });

        // Exclui os endereços existentes, se houver
        if (existingAddresses.length > 0) {
          await tx.address.deleteMany({
            where: { employeeId: id },
          });
        }

        // Cria os novos endereços fornecidos no DTO
        const newAddresses = Array.isArray(address) ? address : [address];
        for (const address of newAddresses) {
          await tx.address.create({
            data: {
              ...address,
              ownerType: 'EMPLOYEE',
              employeeId: id,
            },
          });
        }
      }

      // Registrar no histórico
      if (userId && employeeBefore) {
        const changedFields: string[] = [];
        const changes: any = { before: {}, after: {} };

        // Detectar campos alterados
        Object.keys(rest).forEach((key) => {
          if (
            employeeBefore[key] !== undefined &&
            employeeBefore[key] !== rest[key]
          ) {
            changedFields.push(key);
            changes.before[key] = employeeBefore[key];
            changes.after[key] = rest[key];
          }
        });

        // Tratamento especial para isActive
        if (isActive !== undefined && employeeBefore.isActive !== isActive) {
          const action = isActive ? 'REACTIVATE' : 'DEACTIVATE';
          const description = isActive
            ? this.historyService.getReactivateDescription(
                employeeUpdate.name || 'Sem nome',
              )
            : this.historyService.getDeactivateDescription(
                employeeUpdate.name || 'Sem nome',
              );

          await this.historyService.createEmployeeHistory({
            employeeId: id,
            action,
            description,
            changes: {
              before: { isActive: employeeBefore.isActive },
              after: { isActive },
            },
            createdBy: userId,
            createdByName: userName,
          });
        } else if (changedFields.length > 0) {
          // Registro de alterações normais
          await this.historyService.createEmployeeHistory({
            employeeId: id,
            action: 'UPDATE',
            description:
              this.historyService.getUpdateDescription(changedFields),
            changes,
            metadata: { changedFields },
            createdBy: userId,
            createdByName: userName,
          });
        }
      }

      return employeeUpdate;
    });
  }

  async remove(id: string, userId?: string, userName?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertOwnerStays(tx, id, { deactivating: true });

      const employee = await tx.employee.findUnique({
        where: { id },
        select: { userId: true, name: true },
      });

      if (employee?.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { isActive: false },
        });
      }

      const result = await tx.employee.update({
        where: { id },
        data: {
          isActive: false,
        },
      });

      // Registrar no histórico
      if (userId) {
        await this.historyService.createEmployeeHistory({
          employeeId: id,
          action: 'DEACTIVATE',
          description: this.historyService.getDeactivateDescription(
            employee?.name || 'Sem nome',
          ),
          changes: {
            before: { isActive: true },
            after: { isActive: false },
          },
          createdBy: userId,
          createdByName: userName,
        });
      }

      return result;
    });
  }

  /**
   * Busca o histórico completo de um colaborador
   */
  async getHistory(employeeId: string) {
    return this.historyService.getEmployeeHistory(employeeId);
  }
}

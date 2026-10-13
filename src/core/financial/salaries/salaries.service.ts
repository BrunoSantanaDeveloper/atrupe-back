import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreatePayrollSetupDto } from './dto/create-payroll-setup.dto';
import { FilterPayrollSetupDto } from './dto/filter-payroll-setup.dto';
import { UpdatePayrollSetupDto } from './dto/update-payroll-setup.dto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { fromLegacy, legacyOf } from './payroll-math';
import {
  LINE_SELECT,
  MONTHLY_HOURS,
  PayrollStructureService,
} from './payroll-structure.service';

const PAYROLL_SETUP_NOT_FOUND = 'Item da folha não encontrado.';

@Injectable()
export class SalariesService {
  private readonly logger = new Logger(SalariesService.name);
  constructor(
    private prisma: PrismaService,
    private structure: PayrollStructureService,
  ) {}

  async findAll(filters: FilterPayrollSetupDto) {
    try {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 10;
      const skip = (page - 1) * limit;

      const whereConditions: Prisma.EmployeeWhereInput[] = [
        { companyId: filters.companyId },
        { isActive: true },
      ];

      // Add name filter if search or employeeName is provided
      if (filters.search) {
        whereConditions.push({
          name: {
            contains: filters.search,
            mode: 'insensitive',
          },
        });
      }

      if (filters.employeeId) {
        whereConditions.push({
          id: filters.employeeId,
        });
      }

      // Add sector filter if sectorId is provided
      if (filters.sectorId) {
        whereConditions.push({
          sector: {
            id: filters.sectorId,
          },
        });
      }

      if (filters.costType) {
        whereConditions.push({
          PayrollSetup: {
            some: {
              type: filters.costType,
            },
          },
        });
      }
      const wherePayrollSetup: Prisma.PayrollSetupWhereInput = {};
      if (filters.costType) {
        wherePayrollSetup.type = filters.costType;
      }

      const where: Prisma.EmployeeWhereInput = {
        AND: whereConditions,
      };

      const [employees, total] = await Promise.all([
        this.prisma.employee.findMany({
          where,
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            // O código do colaborador é o do legado
            legacyId: true,
            contract: true,
            baseSalary: true,
            sector: {
              select: {
                id: true,
                name: true,
              },
            },
            role: {
              select: {
                id: true,
                name: true,
              },
            },
            PayrollSetup: {
              select: LINE_SELECT,
              where: wherePayrollSetup,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
          skip,
          take: limit,
          orderBy: {
            name: 'asc',
          },
        }),
        this.prisma.employee.count({ where }),
      ]);
      const data = employees.map((employee) => {
        // Sort payroll setup items
        const sortedItems = [...employee.PayrollSetup].sort((a, b) => {
          const baseSalaryReferences = [
            'Salário base',
            'Salario base',
            'Salário',
            'Salario',
          ];
          const aIsBase =
            !!a.payrollTemplate?.isBase ||
            baseSalaryReferences.includes(a.name);
          const bIsBase =
            !!b.payrollTemplate?.isBase ||
            baseSalaryReferences.includes(b.name);

          if (aIsBase && !bIsBase) return -1;
          if (!aIsBase && bIsBase) return 1;
          return 0;
        });

        // A estrutura com comportamento (ALT-18) vai junto, no mesmo
        // envelope que as telas de hoje leem
        const totals = this.structure.totalsOf(employee.PayrollSetup);
        return {
          id: employee.id,
          code: employee.legacyId ?? null,
          name: employee.name,
          avatarUrl: employee.avatarUrl,
          sectorId: employee.sector.id,
          roleId: employee.role.id,
          sectorName: employee.sector.name,
          roleName: employee.role.name,
          contract: employee.contract,
          baseSalary: employee.baseSalary,
          monthlyHours: MONTHLY_HOURS,
          ...totals,
          items: sortedItems.map((item) => this.structure.lineView(item)),
        };
      });
      return {
        total,
        totalPages: Math.ceil(total / limit),
        page,
        lastPage: Math.max(1, Math.ceil(total / limit)),
        data,
      };
    } catch (error) {
      this.logger.error('Erro ao listar salários', error.stack);
      throw new BadRequestException(
        'Error fetching employees with payroll setups: ' + error.message,
      );
    }
  }

  async create(createPayrollSetupDto: CreatePayrollSetupDto) {
    // Com o comportamento (ALT-18), o type/amount sai dele
    if (createPayrollSetupDto.behavior) {
      const legacy = legacyOf(
        createPayrollSetupDto.behavior,
        createPayrollSetupDto.defaultIncrease ?? 0,
        createPayrollSetupDto.defaultDiscount ?? 0,
      );
      createPayrollSetupDto.type = legacy.type;
      createPayrollSetupDto.amount = legacy.amount;
    } else if (
      !createPayrollSetupDto.type ||
      createPayrollSetupDto.amount === undefined
    ) {
      throw new BadRequestException('Informe o comportamento do item');
    }
    const behavior = createPayrollSetupDto.behavior ?? null;
    const increase = createPayrollSetupDto.behavior
      ? (createPayrollSetupDto.defaultIncrease ?? 0)
      : null;
    const discount = createPayrollSetupDto.behavior
      ? (createPayrollSetupDto.defaultDiscount ?? 0)
      : null;
    try {
      return this.prisma.$transaction(async (tx) => {
        // 1. Criar ou buscar template existente
        const existingTemplate = await tx.payrollTemplate.findUnique({
          where: {
            name_type_companyId: {
              name: createPayrollSetupDto.name,
              type: createPayrollSetupDto.type,
              companyId: createPayrollSetupDto.companyId,
            },
          },
        });

        let template = existingTemplate;
        if (!template) {
          template = await tx.payrollTemplate.create({
            data: {
              name: createPayrollSetupDto.name,
              type: createPayrollSetupDto.type,
              defaultAmount: createPayrollSetupDto.amount,
              companyId: createPayrollSetupDto.companyId,
              behavior,
              defaultIncrease: increase,
              defaultDiscount: discount,
            },
          });
        }

        // 2. Buscar TODOS os funcionários da empresa (ativos e inativos)
        const employees = await tx.employee.findMany({
          where: {
            companyId: createPayrollSetupDto.companyId,
            // Removido isActive: true - aplica a TODOS
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (employees.length === 0) {
          throw new BadRequestException(
            'A empresa não tem colaborador ativo para receber o item',
          );
        }

        // 4. Criar payroll setups para todos os funcionários
        const createdPayrollSetups = await Promise.all(
          employees.map(async (employee) => {
            return await tx.payrollSetup.create({
              data: {
                name: template.name,
                amount: createPayrollSetupDto.amount,
                companyId: createPayrollSetupDto.companyId,
                type: template.type,
                employeeId: employee.id,
                templateId: template.id, // Relacionamento com template
                isSet: createPayrollSetupDto.isSet ?? true,
                behavior,
                increase,
                discount,
              },
              include: {
                employee: {
                  select: {
                    id: true,
                    name: true,
                    sector: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            });
          }),
        );

        return {
          message: `Successfully created payroll setup for ${employees.length} employees`,
          template,
          createdCount: employees.length,
          employees: employees.map((emp) => ({ id: emp.id, name: emp.name })),
          payrollSetups: createdPayrollSetups,
        };
      });
    } catch (error) {
      this.logger.error('Erro ao criar configuração salarial', error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A payroll setup with this name already exists for some employees',
          );
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid company reference');
        }
      }
      throw new BadRequestException(
        'Error creating payroll setup: ' + error.message,
      );
    }
  }

  async update(
    id: string,
    companyId: string,
    updatePayrollSetupDto: UpdatePayrollSetupDto,
    userId?: string,
  ) {
    // Sem troca de colaborador, a edição passa pela estrutura da folha:
    // comportamento, acréscimo e desconto, com o type/amount junto
    if (updatePayrollSetupDto.employeeId === undefined) {
      return this.structure.updateLine(
        companyId,
        userId ?? null,
        id,
        updatePayrollSetupDto,
      );
    }
    try {
      const current = await this.findOwn(id, companyId);

      if (updatePayrollSetupDto.employeeId !== undefined) {
        const employee = await this.prisma.employee.findFirst({
          where: { id: updatePayrollSetupDto.employeeId, companyId },
          select: { id: true },
        });
        if (!employee) {
          throw new NotFoundException('Colaborador não encontrado.');
        }
      }

      const updateData: Prisma.PayrollSetupUpdateInput = {};

      // Only update fields that are provided
      if (updatePayrollSetupDto.name !== undefined) {
        updateData.name = updatePayrollSetupDto.name;
      }

      if (updatePayrollSetupDto.amount !== undefined) {
        updateData.amount = updatePayrollSetupDto.amount;
      }

      if (updatePayrollSetupDto.isSet !== undefined) {
        updateData.isSet = updatePayrollSetupDto.isSet;
      }

      if (updatePayrollSetupDto.type !== undefined) {
        updateData.type = updatePayrollSetupDto.type;
      }
      // O type/amount de antes leva o comportamento junto (ALT-18)
      if (
        updatePayrollSetupDto.amount !== undefined ||
        updatePayrollSetupDto.type !== undefined
      ) {
        Object.assign(
          updateData,
          fromLegacy(
            updatePayrollSetupDto.type ?? current.type,
            updatePayrollSetupDto.amount ?? current.amount,
          ),
        );
      }
      if (updatePayrollSetupDto.employeeId !== undefined) {
        updateData.employee = {
          connect: {
            id: updatePayrollSetupDto.employeeId,
          },
        };
      }

      // Always update the updatedAt timestamp
      updateData.updatedAt = new Date();

      return await this.prisma.payrollSetup.update({
        where: { id },
        data: updateData,
        include: {
          employee: {
            include: {
              sector: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(
            'A payroll setup with this reference already exists',
          );
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('Invalid employee reference');
        }
      }
      throw new BadRequestException(
        'Error updating payroll setup: ' + error.message,
      );
    }
  }

  /**
   * Toda operação por id confere a empresa da sessão: sem isso, o salário de
   * um colaborador de outra empresa era lido, alterado ou apagado pelo id. O
   * id de outra empresa responde 404, como um id que não existe.
   */
  private async findOwn(id: string, companyId: string) {
    const payrollSetup = await this.prisma.payrollSetup.findFirst({
      where: { id, companyId },
      select: { id: true, type: true, amount: true },
    });

    if (!payrollSetup) {
      throw new NotFoundException(PAYROLL_SETUP_NOT_FOUND);
    }

    return payrollSetup;
  }

  async getSalaryDetails(id: string, companyId: string) {
    try {
      const payrollSetup = await this.prisma.payrollSetup.findFirst({
        where: { id, companyId },
        include: {
          employee: {
            include: {
              sector: true,
            },
          },
        },
      });

      if (!payrollSetup) {
        throw new NotFoundException(PAYROLL_SETUP_NOT_FOUND);
      }

      return payrollSetup;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        'Error fetching salary details: ' + error.message,
      );
    }
  }

  async delete(id: string, companyId: string) {
    try {
      await this.findOwn(id, companyId);

      await this.prisma.payrollSetup.delete({
        where: { id },
      });

      return {
        message: 'Payroll setup deleted successfully',
        id,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        'Error deleting payroll setup: ' + error.message,
      );
    }
  }
}

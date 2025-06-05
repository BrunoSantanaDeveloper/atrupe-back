import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import {
  AddPaymentMovementDto,
  AddSalaryItemDto,
  PaySalaryMovementDto,
} from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
  UpdateEmployeeSalaryDto,
} from './dto/update-salary.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';
import { ItemType, Prisma } from '@prisma/client';

@Injectable()
export class SalarySheetsService {
  private readonly logger = new Logger(SalarySheetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_NOON)
  async generateSalarySheetForMonth(): Promise<void> {
    /**
     * Mensalmente, a folha de pagamento é gerada para todos os colaboradores ativos.
     * Se o colaborador não tiver uma folha de pagamento, uma nova folha é criada.
     * Se o colaborador tiver uma folha de pagamento, a folha é atualizada.
     *
     * A folha de pagamento é gerada no primeiro dia do mês para o mês atual.
     * No mês, verifica se o colaborador está ativo, se estiver cria.
     */
    const companies = await this.prisma.company.findMany({
      where: {
        isActive: true,
      },
    });

    const currentDate = new Date();
    const targetMonth = currentDate.getMonth();
    const targetYear = currentDate.getFullYear();

    for (const company of companies) {
      const employees = await this.prisma.employee.findMany({
        where: {
          companyId: company.id,
          isActive: true,
        },
        include: {
          SalaryControl: {
            where: {
              isSet: true,
            },
          },
        },
      });

      for (const employee of employees) {
        try {
          // Verifica se já existe uma folha para o mês/ano
          const existingSheet = await this.prisma.salarySheet.findFirst({
            where: {
              employeeId: employee.id,
              month: targetMonth,
              year: targetYear,
            },
          });

          if (existingSheet) {
            this.logger.warn(
              `Folha de pagamento já existe para o colaborador ${employee.id} no mês ${targetMonth + 1}/${targetYear}`,
            );
            continue;
          }

          // Cria a folha de pagamento dentro de uma transação
          await this.prisma.$transaction(async (prisma) => {
            const salarySheet = await prisma.salarySheet.create({
              data: {
                employeeId: employee.id,
                month: targetMonth,
                year: targetYear,
                status: 'EMPTY',
                companyId: company.id,
              },
            });

            // Cria os itens da folha baseados no SalaryControl
            if (employee.SalaryControl.length > 0) {
              await prisma.salaryItem.createMany({
                data: employee.SalaryControl.map((item) => ({
                  salarySheetId: salarySheet.id,
                  type: item.type,
                  amount: item.amount,
                  description: item.reference,
                  reference: `${targetMonth + 1}/${targetYear}`,
                })),
              });
            } else {
              this.logger.warn(
                `Colaborador ${employee.id} não possui configurações de salário definidas`,
              );
            }
          });

          this.logger.log(
            `Folha de pagamento criada com sucesso para o colaborador ${employee.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Erro ao gerar folha de pagamento para o colaborador ${employee.id}: ${error.message}`,
          );
          // Continua para o próximo colaborador mesmo se houver erro
          continue;
        }
      }
    }
  }

  async openSalarySheet(salarySheetId: string) {
    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
      include: {
        employee: true,
      },
    });

    if (!salarySheet || salarySheet.status !== 'EMPTY') {
      throw new NotFoundException(
        'Folha de pagamento não encontrada ou já está aberta.',
      );
    }

    await this.prisma.salarySheet.update({
      where: { id: salarySheetId },
      data: { status: 'OPEN' },
    });

    const salaryBase = salarySheet.employee.sallary || 0;
    const salaryItem = await this.prisma.salaryItem.create({
      data: {
        salarySheetId: salarySheetId,
        type: 'INCREASE',
        description: 'Salário Base',
        amount: salaryBase,
        reference: `${salarySheet.month + 1}/${salarySheet.year}`,
      },
    });

    return {
      message: 'Folha de pagamento aberta e salário base criado.',
      salaryItem,
    };
  }

  async getSalarySheets(dto: GetSalarySheetsDto) {
    try {
      const { companyId, search } = dto;
      const page = parseInt(dto.page);
      const limit = parseInt(dto.limit);
      const month = dto.month || new Date().getMonth() + 1;
      const year = dto.year || new Date().getFullYear();

      // Ajusta o mês para o formato do banco (0-11)
      const adjustedMonth = month - 1;

      const where: Prisma.SalarySheetWhereInput = {
        companyId,
        month: adjustedMonth,
        year,
        ...(search && {
          employee: {
            user: {
              name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        }),
      };

      const [salarySheets, total] = await this.prisma.$transaction([
        this.prisma.salarySheet.findMany({
          where,
          include: {
            employee: {
              include: {
                user: true,
                role: true,
              },
            },
            items: true,
          },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.salarySheet.count({ where }),
      ]);

      const data = salarySheets.map((sheet) => {
        const totalIncreases = sheet.items
          .filter((item) => item.type === ItemType.INCREASE)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = sheet.items
          .filter((item) => item.type === ItemType.DISCOUNT)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalSalary = totalIncreases - totalDiscounts;

        const totalAdvances = sheet.items
          .filter((item) => item.type === ItemType.ADVANCE)
          .reduce((sum, item) => sum + item.amount, 0);

        const advances = totalSalary - totalAdvances;

        return {
          id: sheet.id,
          employee: {
            id: sheet.employee?.id,
            name: sheet.employee?.name || 'Nome não disponível',
            role: sheet.employee?.role?.name || 'Cargo não definido',
          },
          totalSalary,
          balance: advances,
          status: sheet.status,
        };
      });

      return {
        data,
        count: total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar folhas de pagamento: ${error.message}`);
      throw new BadRequestException('Erro ao buscar folhas de pagamento');
    }
  }

  async getSalarySheetById(id: string) {
    try {
      const salarySheet = await this.prisma.salarySheet.findUnique({
        where: { id },
        include: {
          employee: {
            include: {
              user: true,
              role: true,
            },
          },
          items: {
            include: {
              salarySheet: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          movements: {
            include: {
              paymentMethod: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

      if (!salarySheet) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Calcula o saldo a pagar
      const totalSalary = salarySheet.items
        .filter((item) => item.type === ItemType.INCREASE)
        .reduce((sum, item) => sum + item.amount, 0);

      const advances = salarySheet.items
        .filter((item) => item.type === ItemType.ADVANCE)
        .reduce((sum, item) => sum + item.amount, 0);

      const balance = totalSalary - advances;

      return {
        data: {
          id: salarySheet.id,
          month: salarySheet.month + 1, // Ajusta para formato 1-12
          year: salarySheet.year,
          status: salarySheet.status,
          employee: {
            id: salarySheet.employee.id,
            name: salarySheet.employee.user.name,
            role: salarySheet.employee.role.name,
          },
          items: salarySheet.items.map((item) => ({
            id: item.id,
            type: item.type,
            amount: item.amount,
            description: item.description,

            createdAt: item.createdAt,
          })),
          balance,
          movements: salarySheet.movements.map((movement) => ({
            id: movement.id,
            amount: movement.amount,
            status: movement.paymentStatus,
            paidDate: movement.paidDate,
            paymentMethod: movement.paymentMethod
              ? {
                  id: movement.paymentMethod.id,
                  name: movement.paymentMethod.name,
                }
              : null,
            createdAt: movement.createdAt,
          })),
        },
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar folha de pagamento: ${error.message}`);
      throw new BadRequestException('Erro ao buscar folha de pagamento');
    }
  }

  async addSalaryItem(addSalaryItemDto: AddSalaryItemDto) {
    try {
      const { salarySheetId, type, amount, description } = addSalaryItemDto;

      const salarySheet = await this.prisma.salarySheet.findUnique({
        where: { id: salarySheetId },
      });
      const reference = `${salarySheet.month + 1}/${salarySheet.year}`;

      if (!salarySheet || salarySheet.status !== 'OPEN') {
        throw new NotFoundException(
          'Folha de pagamento não encontrada ou não está aberta.',
        );
      }
      const salaryItem = await this.prisma.salaryItem.create({
        data: {
          salarySheetId,
          reference,
          type,
          amount,
          description,
        },
      });
      if (type === 'ADVANCE') {
        const movementDto: AddPaymentMovementDto = {
          salarySheetId,
          amount,
          paidDate: null, // Data atual
          paymentMethodId: null, // Deixar nulo até ser definido pelo gestor
          paymentStatus: 'PENDING', // Status inicial
        };

        await this.addPaymentMovement(movementDto);
      }

      return salaryItem;
    } catch (error) {
      console.error('Error creating payment movement:', error.message);
      throw new BadRequestException('Erro ao criar item de pagamento.');
    }
  }

  async updateSalaryItem(updateSalaryItemDto: UpdateSalaryItemDto) {
    const { id, ...itemData } = updateSalaryItemDto;

    const salaryItem = await this.prisma.salaryItem.findUnique({
      where: { id },
    });

    if (!salaryItem) {
      throw new NotFoundException('Item de folha de pagamento não encontrado.');
    }

    const updatedSalaryItem = await this.prisma.salaryItem.update({
      where: { id },
      data: itemData,
    });

    return updatedSalaryItem;
  }

  async toggleSalarySheetStatus(dto: ToggleSalarySheetStatusDto) {
    const { salarySheetId, status } = dto;

    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!salarySheet) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    if (salarySheet.status === status) {
      throw new BadRequestException(`A folha já está no estado ${status}.`);
    }

    const updatedSalarySheet = await this.prisma.salarySheet.update({
      where: { id: salarySheetId },
      data: { status },
    });

    return updatedSalarySheet;
  }

  async addPaymentMovement(dto: AddPaymentMovementDto) {
    const { salarySheetId, ...movementData } = dto;

    // Validar existência da folha de pagamento
    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salarySheetId },
    });

    if (!salarySheet) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    // Criar movimentação
    const paymentMovement = await this.prisma.paymentMovement.create({
      data: {
        salarySheetId,
        ...movementData,
      },
    });

    return paymentMovement;
  }

  async payMovement(dto: PaySalaryMovementDto) {
    const { movementId, paidDate, paidAmount, paymentMethodId } = dto;

    // Verificar existência da movimentação
    const movement = await this.prisma.paymentMovement.findUnique({
      where: { id: movementId },
    });

    if (!movement) {
      throw new NotFoundException('Movimentação não encontrada.');
    }

    if (movement.paymentStatus === 'PAID') {
      throw new BadRequestException('Movimentação já foi paga.');
    }

    // Atualizar movimentação para pago
    const updatedMovement = await this.prisma.paymentMovement.update({
      where: { id: movementId },
      data: {
        paidDate: new Date(paidDate),
        amount: paidAmount,
        paymentMethodId,
        paymentStatus: 'PAID',
      },
    });

    return updatedMovement;
  }

  async updateEmployeeSalary(dto: UpdateEmployeeSalaryDto) {
    const { employeeId, salary } = dto;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Colaborador não encontrado');
    }

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { sallary: salary },
    });

    // Atualizar folha de pagamento atual se existir
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    const currentSalarySheet = await this.prisma.salarySheet.findFirst({
      where: {
        employeeId,
        month: currentMonth,
        year: currentYear,
        status: 'OPEN',
      },
    });

    if (currentSalarySheet) {
      // Atualizar ou criar item de salário base
      const baseSalaryItem = await this.prisma.salaryItem.findFirst({
        where: {
          salarySheetId: currentSalarySheet.id,
          type: 'INCREASE',
          description: 'Salário Base',
        },
      });

      if (baseSalaryItem) {
        await this.prisma.salaryItem.update({
          where: { id: baseSalaryItem.id },
          data: { amount: salary },
        });
      } else {
        await this.prisma.salaryItem.create({
          data: {
            salarySheetId: currentSalarySheet.id,
            type: 'INCREASE',
            description: 'Salário Base',
            amount: salary,
            reference: `${currentMonth + 1}/${currentYear}`,
          },
        });
      }
    }

    return updatedEmployee;
  }
}

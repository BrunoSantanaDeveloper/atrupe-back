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

  async generateSalarySheetForEmployees(data: {
    month: number;
    year: number;
    list: string[];
  }): Promise<{
    success: number;
    skipped: number;
    errors: Array<{ employeeId: string; reason: string }>;
  }> {
    const { month, year, list: employeeIds } = data;

    // Validação dos parâmetros
    if (!month || month < 1 || month > 12) {
      throw new BadRequestException(
        'Mês inválido. Deve ser um número entre 1 e 12',
      );
    }

    if (!year || year < 2000 || year > 9999) {
      throw new BadRequestException('Ano inválido');
    }

    if (!employeeIds?.length) {
      throw new BadRequestException(
        'Lista de colaboradores não pode estar vazia',
      );
    }

    const result = {
      success: 0,
      skipped: 0,
      errors: [] as Array<{ employeeId: string; reason: string }>,
    };

    // Busca todos os colaboradores de uma vez
    const employees = await this.prisma.employee.findMany({
      where: {
        id: { in: employeeIds },
      },
      include: {
        SalaryControl: {
          where: {
            isSet: true,
          },
        },
        company: true,
      },
    });

    // Cria um mapa para acesso rápido
    const employeeMap = new Map(employees.map((emp) => [emp.id, emp]));

    // Busca todas as folhas existentes de uma vez
    const existingSheets = await this.prisma.salarySheet.findMany({
      where: {
        employeeId: { in: employeeIds },
        month,
        year,
      },
      select: {
        employeeId: true,
      },
    });

    const existingEmployeeIds = new Set(
      existingSheets.map((sheet) => sheet.employeeId),
    );

    for (const employeeId of employeeIds) {
      try {
        const employee = employeeMap.get(employeeId);

        if (!employee) {
          result.errors.push({
            employeeId,
            reason: 'Colaborador não encontrado',
          });
          continue;
        }

        if (!employee.company?.isActive || !employee.isActive) {
          result.errors.push({
            employeeId,
            reason: 'Colaborador ou empresa não estão ativos',
          });
          continue;
        }

        if (existingEmployeeIds.has(employeeId)) {
          result.skipped++;
          this.logger.warn(
            `Folha de pagamento já existe para o colaborador ${employeeId} no mês ${month}/${year}`,
          );
          continue;
        }

        await this.prisma.$transaction(async (prisma) => {
          const salarySheet = await prisma.salarySheet.create({
            data: {
              employeeId: employee.id,
              month,
              year,
              status: 'OPEN',
              companyId: employee.companyId,
            },
          });

          if (employee.SalaryControl.length > 0) {
            await prisma.salaryItem.createMany({
              data: employee.SalaryControl.map((item) => ({
                salarySheetId: salarySheet.id,
                type: item.type,
                amount: item.amount,
                description: item.reference,
                reference: `${month}/${year}`,
              })),
            });
          } else {
            this.logger.warn(
              `Colaborador ${employeeId} não possui configurações de salário definidas`,
            );
          }
        });

        result.success++;
        this.logger.log(
          `Folha de pagamento criada com sucesso para o colaborador ${employeeId}`,
        );
      } catch (error) {
        result.errors.push({
          employeeId,
          reason: error.message,
        });
        this.logger.error(
          `Erro ao gerar folha de pagamento para o colaborador ${employeeId}: ${error.message}`,
        );
      }
    }

    return result;
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

      // Busca todos os employees ativos da empresa
      const where: Prisma.EmployeeWhereInput = {
        companyId,
        isActive: true,
        ...(search && {
          user: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        }),
      };

      const [employees, total] = await this.prisma.$transaction([
        this.prisma.employee.findMany({
          where,
          include: {
            user: true,
            role: true,
            SalaryControl: {
              where: {
                isSet: true,
              },
            },
            salarySheet: {
              where: {
                month: adjustedMonth,
                year,
              },
              include: {
                items: true,
                movements: true,
              },
            },
          },
          orderBy: {
            name: 'asc',
          },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.employee.count({ where }),
      ]);

      const data = employees.map((employee) => {
        const salarySheet = employee.salarySheet[0]; // Pega a folha do mês/ano se existir

        // Calcula o salário baseado nas configurações do colaborador
        const totalIncreases = salarySheet?.items
          .filter((item) => item.type === ItemType.INCREASE)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = salarySheet?.items
          .filter((item) => item.type === ItemType.DISCOUNT)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalSalary = totalIncreases - totalDiscounts;

        const totalAdvances = salarySheet?.items
          .filter((item) => item.type === ItemType.ADVANCE)
          .reduce((sum, item) => sum + item.amount, 0);

        const balance = totalSalary - totalAdvances;

        return {
          id: salarySheet?.id || null,
          month,
          year,
          employee: {
            id: employee.id,
            name: employee.name,
            role: employee.role?.name || 'Cargo não informado',
          },
          totalSalary,
          balance,
          status: salarySheet?.status || 'EMPTY',
          items: salarySheet?.items || [],
          movements: salarySheet?.movements || [],
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

      // Buscar funcionário para obter o nome
      const employee = await this.prisma.employee.findUnique({
        where: { id: salarySheet.employeeId },
        include: {
          user: true,
        },
      });

      const employeeName =
        employee?.user?.name || employee?.name || 'Funcionário';

      // Primeiro, buscar payables específicos desta folha
      let relatedPayables = await this.prisma.payable.findMany({
        where: {
          companyId: salarySheet.companyId,
          AND: [
            {
              description: {
                contains: `Adiantamento salarial - ${employeeName}`,
              },
            },
            {
              notes: {
                contains: `folha de pagamento ${salarySheet.month + 1}/${salarySheet.year}`,
              },
            },
          ],
        },
        include: {
          installments: {
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      // Se não encontrou payables específicos, buscar todos os adiantamentos do funcionário
      if (relatedPayables.length === 0) {
        relatedPayables = await this.prisma.payable.findMany({
          where: {
            companyId: salarySheet.companyId,
            description: {
              contains: `Adiantamento salarial - ${employeeName}`,
            },
          },
          include: {
            installments: {
              orderBy: {
                installmentNumber: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });
      }

      // Log para debug - informações importantes
      console.log('=== DEBUG SALARY SHEET PAYABLES ===');
      console.log(`Funcionário: ${employeeName}`);
      console.log(`Folha: ${salarySheet.month + 1}/${salarySheet.year}`);
      console.log(`Company ID: ${salarySheet.companyId}`);
      console.log(`Payables encontrados: ${relatedPayables.length}`);

      if (relatedPayables.length > 0) {
        relatedPayables.forEach((payable, index) => {
          console.log(
            `Payable ${index + 1}: ID=${payable.id}, Valor=${payable.totalAmount}, Descrição=${payable.description}`,
          );
        });
      } else {
        console.log(
          'Nenhum payable encontrado - verificar se foram criados anteriormente',
        );
      }
      console.log('=== END DEBUG ===');

      // Calcula o saldo a pagar
      const totalSalary = salarySheet.items
        .filter((item) => item.type === ItemType.INCREASE)
        .reduce((sum, item) => sum + item.amount, 0);

      const advances = salarySheet.items
        .filter((item) => item.type === ItemType.ADVANCE)
        .reduce((sum, item) => sum + item.amount, 0);

      const balance = totalSalary - advances;

      // Mapear itens da folha e incluir payables para ADVANCE
      const itemsWithPayables = salarySheet.items.map((item) => {
        const baseItem = {
          id: item.id,
          type: item.type,
          amount: item.amount,
          description: item.description,
          paidAt: item.paidAt,
          createdAt: item.createdAt,
        };

        // Se for ADVANCE, buscar o payable relacionado
        if (item.type === ItemType.ADVANCE) {
          // Log para debug
          this.logger.log(
            `Processando item ADVANCE: ${item.description}, valor: ${item.amount}`,
          );

          // Buscar payable que contenha a descrição do item ou que tenha o mesmo valor
          const relatedPayable = relatedPayables.find(
            (payable) =>
              payable.description.includes(item.description) ||
              payable.totalAmount === item.amount,
          );

          if (relatedPayable) {
            this.logger.log(
              `Payable encontrado para item ${item.id}: ${relatedPayable.id}`,
            );
            return {
              ...baseItem,
              payable: {
                id: relatedPayable.id,
                description: relatedPayable.description,
                totalAmount: relatedPayable.totalAmount,
                status: relatedPayable.status,
                referenceDate: relatedPayable.referenceDate,
                installments: relatedPayable.installments.map(
                  (installment) => ({
                    id: installment.id,
                    installmentNumber: installment.installmentNumber,
                    dueDate: installment.dueDate,
                    amount: installment.amount,
                    status: installment.status,
                    paidDate: installment.paidDate,
                  }),
                ),
              },
            };
          } else {
            this.logger.warn(
              `Nenhum payable encontrado para item ADVANCE ${item.id}`,
            );
          }
        }

        return baseItem;
      });

      return {
        id: salarySheet.id,
        month: salarySheet.month + 1, // Ajusta para formato 1-12
        year: salarySheet.year,
        status: salarySheet.status,
        employee: {
          id: salarySheet.employee.id,
          name:
            salarySheet.employee.user?.name ||
            salarySheet.employee.name ||
            'Nome não informado',
          role: salarySheet.employee.role?.name || 'Cargo não informado',
        },
        balance,
        items: itemsWithPayables,
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

      if (!salarySheet || salarySheet.status !== 'OPEN') {
        throw new NotFoundException(
          'Folha de pagamento não encontrada ou não está aberta.',
        );
      }

      const reference = `${salarySheet.month + 1}/${salarySheet.year}`;
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
        // Para adiantamentos, criamos automaticamente uma conta a pagar (despesa)
        await this.createAdvanceExpense(salarySheet, amount, description);
        this.logger.log(
          `Adiantamento criado para folha ${salarySheetId}, valor: ${amount} - Despesa gerada automaticamente`,
        );
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

    const salarySheet = await this.prisma.salarySheet.findUnique({
      where: { id: salaryItem.salarySheetId },
    });

    if (!salarySheet || salarySheet.status !== 'OPEN') {
      throw new NotFoundException(
        'Folha de pagamento não encontrada ou não está aberta.',
      );
    }

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

  private async createAdvanceExpense(
    salarySheet: any,
    amount: number,
    description: string,
  ) {
    try {
      // Buscar dados do funcionário
      const employee = await this.prisma.employee.findUnique({
        where: { id: salarySheet.employeeId },
        include: {
          user: true,
        },
      });

      const employeeName =
        employee?.user?.name || employee?.name || 'Funcionário';
      const currentDate = new Date();

      // Criar conta a pagar (despesa) para o adiantamento
      const payable = await this.prisma.payable.create({
        data: {
          referenceDate: currentDate,
          description: `Adiantamento salarial - ${employeeName}: ${description}`,
          notes: `Adiantamento gerado automaticamente para folha de pagamento ${salarySheet.month + 1}/${salarySheet.year}`,
          totalAmount: amount,
          totalValue: amount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: salarySheet.companyId,
        },
      });

      // Criar a parcela única com vencimento imediato
      await this.prisma.payableInstallment.create({
        data: {
          payableId: payable.id,
          installmentNumber: 1,
          dueDate: currentDate, // Vencimento imediato
          amount: amount,
          additionalFee: 0,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `Despesa criada automaticamente para adiantamento: ${payable.id}`,
      );

      return payable;
    } catch (error) {
      this.logger.error(
        `Erro ao criar despesa para adiantamento: ${error.message}`,
      );
      // Não propaga o erro para não bloquear a criação do adiantamento
      // A despesa pode ser criada manualmente se necessário
    }
  }
}

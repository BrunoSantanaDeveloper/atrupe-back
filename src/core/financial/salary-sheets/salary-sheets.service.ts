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
} from './dto/update-salary.dto';
import { Logger } from '@nestjs/common';
import { ItemType, Prisma } from '@prisma/client';

@Injectable()
export class SalarySheetsService {
  private readonly logger = new Logger(SalarySheetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Recebe o mes, ano, e uma lista de colaboradores para gerar folha de pagamento.
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
        user: true,
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

            // Calcular salário líquido e criar despesa
            const salaryItems = employee.SalaryControl;
            const totalIncreases = salaryItems
              .filter((item) => item.type === 'INCREASE')
              .reduce((sum, item) => sum + item.amount, 0);

            const totalDiscounts = salaryItems
              .filter((item) => item.type === 'DISCOUNT')
              .reduce((sum, item) => sum + item.amount, 0);

            const netSalary = totalIncreases - totalDiscounts;

            // Criar despesa apenas se há valor líquido a pagar
            if (netSalary > 0) {
              await this.createSalaryExpense(salarySheet, netSalary);
            }
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

      // Buscar TODAS as despesas do colaborador usando employeeId e expenseSource
      const relatedPayables = await this.prisma.payable.findMany({
        where: {
          companyId: salarySheet.companyId,
          employeeId: salarySheet.employeeId,
          expenseSource: 'EMPLOYEE',
        },
        include: {
          installments: {
            include: {
              transactions: {
                include: {
                  cashRegister: {
                    include: {
                      bankAccount: {
                        include: {
                          bank: true,
                        },
                      },
                    },
                  },
                },
              },
              paymentMethod: true,
              bankAccount: {
                include: {
                  bank: true,
                },
              },
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      if (relatedPayables.length > 0) {
        relatedPayables.forEach((payable, index) => {
          this.logger.log(
            `Payable ${index + 1}: ID=${payable.id}, Valor=${payable.totalAmount}, Descrição=${payable.description}`,
          );
        });
      } else {
        this.logger.log(
          'Nenhum payable encontrado - verificar se foram criados anteriormente',
        );
      }

      // Calcula o saldo a pagar
      const totalIncreases = salarySheet.items
        .filter((item) => item.type === ItemType.INCREASE)
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = salarySheet.items
        .filter((item) => item.type === ItemType.DISCOUNT)
        .reduce((sum, item) => sum + item.amount, 0);

      const advances = salarySheet.items
        .filter((item) => item.type === ItemType.ADVANCE)
        .reduce((sum, item) => sum + item.amount, 0);

      const balance = totalIncreases - totalDiscounts - advances;

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
                    paidAmount: installment.paidAmount,
                    paymentMethod: installment.paymentMethod
                      ? {
                          id: installment.paymentMethod.id,
                          name: installment.paymentMethod.name,
                        }
                      : null,
                    bankAccount: installment.bankAccount
                      ? {
                          id: installment.bankAccount.id,
                          name: installment.bankAccount.name,
                          bank: installment.bankAccount.bank,
                        }
                      : null,
                    transaction: installment.transactions
                      ? {
                          id: installment.transactions.id,
                          type: installment.transactions.type,
                          amount: installment.transactions.amount,
                          description: installment.transactions.description,
                          transactionDate:
                            installment.transactions.transactionDate,
                          reason: installment.transactions.reason,
                          cashRegister: {
                            id: installment.transactions.cashRegister.id,
                            description:
                              installment.transactions.cashRegister.description,
                            bankAccount: {
                              id: installment.transactions.cashRegister
                                .bankAccount.id,
                              name: installment.transactions.cashRegister
                                .bankAccount.name,
                              bank: installment.transactions.cashRegister
                                .bankAccount.bank,
                            },
                          },
                        }
                      : null,
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

      // Listar todas as transações financeiras sem filtros ou separações
      const financialTransactions = [];

      this.logger.log(
        `Listando todas as ${relatedPayables.length} despesas encontradas`,
      );

      relatedPayables.forEach((payable) => {
        payable.installments.forEach((installment) => {
          // Adicionar TODAS as parcelas, independente do status
          const transactionData = {
            id: installment.id,
            amount: installment.amount,
            description: payable.description,
            transactionDate: installment.dueDate,
            status: installment.status,
            relatedPayable: {
              id: payable.id,
              description: payable.description,
              totalAmount: payable.totalAmount,
            },
            relatedInstallment: {
              id: installment.id,
              installmentNumber: installment.installmentNumber,
              amount: installment.amount,
              status: installment.status,
            },
            createdAt: installment.createdAt,
          };

          financialTransactions.push(transactionData);
        });
      });

      this.logger.log(
        `Total de transações listadas: ${financialTransactions.length}`,
      );

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
        financialTransactions: financialTransactions.sort((a, b) => {
          // Primeiro ordenar por status (COMPLETED primeiro, depois PENDING)
          if (a.status !== b.status) {
            if (a.status === 'COMPLETED' && b.status === 'PENDING') return -1;
            if (a.status === 'PENDING' && b.status === 'COMPLETED') return 1;
          }
          // Depois ordenar por data (mais recente primeiro)
          return (
            new Date(b.transactionDate).getTime() -
            new Date(a.transactionDate).getTime()
          );
        }),
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

  private async createSalaryExpense(salarySheet: any, netAmount: number) {
    try {
      // Competência: primeiro dia do mês da folha
      const referenceDate = new Date(salarySheet.year, salarySheet.month, 1);

      // Vencimento: dia 5 do mês da folha
      const dueDate = new Date(salarySheet.year, salarySheet.month, 5);

      // Criar conta a pagar (despesa) para o salário líquido
      const payable = await this.prisma.payable.create({
        data: {
          referenceDate: referenceDate,
          description: `Folha ${salarySheet.month + 1}/${salarySheet.year} - Salário`,
          totalAmount: netAmount,
          totalValue: netAmount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: salarySheet.companyId,
          expenseSource: 'EMPLOYEE',
          employeeId: salarySheet.employeeId,
        },
      });

      // Criar a parcela única com vencimento no dia 5 do mês
      await this.prisma.payableInstallment.create({
        data: {
          payableId: payable.id,
          installmentNumber: 1,
          dueDate: dueDate,
          amount: netAmount,
          additionalFee: 0,
          status: 'PENDING',
        },
      });

      this.logger.log(
        `Despesa de salário criada automaticamente: ${payable.id} - R$ ${(netAmount / 100).toFixed(2)}`,
      );

      return payable;
    } catch (error) {
      this.logger.error(`Erro ao criar despesa de salário: ${error.message}`);
      // Não propaga o erro para não bloquear a criação da folha
    }
  }

  private async createAdvanceExpense(
    salarySheet: any,
    amount: number,
    description: string,
  ) {
    try {
      const currentDate = new Date();

      // Criar conta a pagar (despesa) para o adiantamento
      const payable = await this.prisma.payable.create({
        data: {
          referenceDate: currentDate,
          description: `Folha ${salarySheet.month + 1}/${salarySheet.year} - ${description}`,
          totalAmount: amount,
          totalValue: amount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: salarySheet.companyId,
          expenseSource: 'EMPLOYEE',
          employeeId: salarySheet.employeeId,
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

  async getSalarySheetPdfData(id: string) {
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
          company: {
            include: {
              address: {
                where: { type: 'Principal' },
              },
            },
          },
          items: {
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

      // Buscar dados da empresa
      const companyAddress = salarySheet.company.address[0];

      // Calcular salário líquido
      const totalIncreases = salarySheet.items
        .filter((item) => item.type === 'INCREASE')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = salarySheet.items
        .filter((item) => item.type === 'DISCOUNT')
        .reduce((sum, item) => sum + item.amount, 0);

      const netSalary = totalIncreases - totalDiscounts;

      // Buscar movimento de pagamento mais recente
      const latestMovement = salarySheet.movements[0];

      // Estruturar dados para o PDF
      const pdfData = {
        company: {
          name: salarySheet.company.name,
          cnpj: salarySheet.company.cnpj,
          email: salarySheet.company.email,
          logo: salarySheet.company.logoUrl,
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
              }
            : null,
        },
        employeeName:
          salarySheet.employee.user?.name || salarySheet.employee.name,
        reference: `${salarySheet.month + 1}/${salarySheet.year}`,
        items: salarySheet.items.map((item) => ({
          id: item.id,
          description: item.description,
          type: item.type,
          amount: item.amount,
        })),
        netSalary,
        payment: latestMovement
          ? {
              dueDate: latestMovement.paidDate.toISOString().split('T')[0],
              paidAt: latestMovement.paidDate.toISOString().split('T')[0],
              amountPaid: latestMovement.amount,
              paymentMethod: latestMovement.paymentMethod?.name,
            }
          : null,
      };

      return pdfData;
    } catch (error) {
      this.logger.error(
        `Erro ao gerar dados do PDF da folha de pagamento: ${error.message}`,
      );
      throw new BadRequestException(
        'Erro ao gerar dados do PDF da folha de pagamento',
      );
    }
  }
}

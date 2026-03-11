import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import { AddSalaryItemDto } from './dto/create-salary.dto';
import {
  ToggleSalarySheetStatusDto,
  UpdateSalaryItemDto,
} from './dto/update-salary.dto';
import { Logger } from '@nestjs/common';
import { ItemType, Prisma } from '@prisma/client';
import { SalaryExpenseService } from './salary-expense.service';
import { SalaryPdfService } from './salary-pdf.service';

@Injectable()
export class SalarySheetsService {
  private readonly logger = new Logger(SalarySheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expenseService: SalaryExpenseService,
    private readonly pdfService: SalaryPdfService,
  ) {}

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
    if (month === undefined || month === null || month < 0 || month > 11) {
      throw new BadRequestException(
        'Mês inválido. Deve ser um número entre 0 e 11',
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
        PayrollSetup: {
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
    const existingSheets = await this.prisma.payroll.findMany({
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

        // Verificar se colaborador tem pelo menos um item com isSet true
        const activeItems = employee.PayrollSetup.filter(
          (item) => item.isSet === true,
        );
        if (activeItems.length === 0) {
          result.errors.push({
            employeeId,
            reason:
              'Colaborador não possui itens ativos (isSet = true) nas configurações de salário',
          });
          this.logger.warn(
            `Colaborador ${employeeId} não possui itens ativos nas configurações de salário`,
          );
          continue;
        }

        // Calcular salário líquido antes de criar a folha

        const totalIncreases = activeItems
          .filter((item) => item.type === 'INCREASE')
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = activeItems
          .filter((item) => item.type === 'DISCOUNT')
          .reduce((sum, item) => sum + item.amount, 0);

        const netSalary = totalIncreases - totalDiscounts;

        await this.prisma.$transaction(async (prisma) => {
          const payroll = await prisma.payroll.create({
            data: {
              employeeId: employee.id,
              month,
              year,
              status: 'OPEN',
              companyId: employee.companyId,
            },
          });

          // Criar itens da folha usando apenas itens ativos
          await prisma.payrollItem.createMany({
            data: activeItems.map((item) => ({
              payrollId: payroll.id,
              type: item.type,
              amount: item.amount,
              description: item.name,
            })),
          });

          // Criar despesa sempre que a folha for lançada
          // Para salários negativos, a despesa deve ser 0
          const expenseAmount = netSalary < 0 ? 0 : netSalary;
          await this.expenseService.createSalaryExpense(payroll, expenseAmount);
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
      const month = dto.month !== undefined ? dto.month : new Date().getMonth();
      const year = dto.year || new Date().getFullYear();

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
            PayrollSetup: {
              where: {
                isSet: true,
              },
            },
            payroll: {
              where: {
                month,
                year,
              },
              include: {
                items: true,
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
        const payroll = employee.payroll[0]; // Pega a folha do mês/ano se existir

        // Calcula o salário baseado nas configurações do colaborador
        const totalIncreases = payroll?.items
          .filter((item) => item.type === ItemType.INCREASE)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalDiscounts = payroll?.items
          .filter((item) => item.type === ItemType.DISCOUNT)
          .reduce((sum, item) => sum + item.amount, 0);

        const totalSalary = totalIncreases - totalDiscounts;

        const totalAdvances = payroll?.items
          .filter((item) => item.type === ItemType.ADVANCE)
          .reduce((sum, item) => sum + item.amount, 0);

        const balance = totalSalary - totalAdvances;

        return {
          id: payroll?.id || null,
          month,
          year,
          employee: {
            id: employee.id,
            name: employee.name,
            role: employee.role?.name || 'Cargo não informado',
          },
          totalSalary,
          balance,
          status: payroll?.status || 'EMPTY',
          items: payroll?.items || [],
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
      const payroll = await this.prisma.payroll.findUnique({
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
              payroll: true,
            },
            orderBy: [
              {
                createdAt: 'asc',
              },
              {
                id: 'asc',
              },
            ],
          },
        },
      });

      if (!payroll) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Buscar despesas do colaborador específicas do mês/ano da folha
      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const relatedPayables = await this.prisma.payable.findMany({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          subCategory: true,
          nature: true,
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
              paymentCondition: true,
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
      const totalIncreases = payroll.items
        .filter((item) => item.type === ItemType.INCREASE)
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = payroll.items
        .filter((item) => item.type === ItemType.DISCOUNT)
        .reduce((sum, item) => sum + item.amount, 0);

      const advances = payroll.items
        .filter((item) => item.type === ItemType.ADVANCE)
        .reduce((sum, item) => sum + item.amount, 0);

      const balance = totalIncreases - totalDiscounts - advances;

      // Mapear itens da folha e incluir payables para ADVANCE
      const itemsWithPayables = payroll.items.map((item) => {
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
          // Adicionar TODAS as parcelas, seguindo o formato do payable findAll
          const transactionData = {
            type: 'payable',
            id: payable.id,
            totalValue: payable.totalAmount || 0,
            totalPaid: payable.installments.reduce(
              (sum, item) => sum + (item.paidAmount ?? 0),
              0,
            ),
            description: payable.description || '',
            employee: payroll.employee
              ? {
                  id: payroll.employee.id,
                  name:
                    payroll.employee.user?.name ||
                    payroll.employee.name ||
                    'Nome não informado',
                }
              : null,
            subCategory: payable.subCategory
              ? {
                  id: payable.subCategory.id,
                  name: payable.subCategory.description,
                }
              : null,
            nature: payable.nature
              ? {
                  id: payable.nature.id,
                  name: payable.nature.description,
                }
              : null,
            installmentsQuantity: payable.installments?.length || 0,
            period: payable.referenceDate || null,
            notes: payable.notes || '',
            status: payable.status || 'UNKNOWN',
            // Parcela atual correspondente à linha
            currentInstallment: {
              id: installment.id,
              installmentNumber: installment.installmentNumber || 1,
              status: installment.status || 'UNKNOWN',
              value: installment.amount || 0,
              additionalFee: installment.additionalFee || 0,
              dueDate: installment.dueDate || null,
              paidValue: installment.paidAmount || 0,
              paymentDate: installment.paidDate || null,
              bankAccount: installment.bankAccount
                ? {
                    id: installment.bankAccount.id,
                    name: installment.bankAccount.name,
                    bank: installment.bankAccount.bank,
                  }
                : null,
            },
          };

          financialTransactions.push(transactionData);
        });
      });

      this.logger.log(
        `Total de transações listadas: ${financialTransactions.length}`,
      );

      return {
        id: payroll.id,
        month: payroll.month,
        year: payroll.year,
        status: payroll.status,
        employee: {
          id: payroll.employee.id,
          name:
            payroll.employee.user?.name ||
            payroll.employee.name ||
            'Nome não informado',
          role: payroll.employee.role?.name || 'Cargo não informado',
        },
        balance,
        items: itemsWithPayables,
        financialTransactions,
      };
    } catch (error) {
      this.logger.error(`Erro ao buscar folha de pagamento: ${error.message}`);
      throw new BadRequestException('Erro ao buscar folha de pagamento');
    }
  }

  async addSalaryItem(payrollId: string, addSalaryItemDto: AddSalaryItemDto) {
    try {
      const { type, amount, description } = addSalaryItemDto;

      const payroll = await this.prisma.payroll.findUnique({
        where: { id: payrollId },
      });

      if (!payroll || payroll.status !== 'OPEN') {
        throw new NotFoundException(
          'Folha de pagamento não encontrada ou não está aberta.',
        );
      }

      // Buscar itens atuais da folha para calcular o saldo
      const currentItems = await this.prisma.payrollItem.findMany({
        where: { payrollId },
      });

      const totalIncreases = currentItems
        .filter((item) => item.type === 'INCREASE')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = currentItems
        .filter((item) => item.type === 'DISCOUNT')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalAdvances = currentItems
        .filter((item) => item.type === 'ADVANCE')
        .reduce((sum, item) => sum + item.amount, 0);

      // Calcular o saldo atual (salário a receber)
      const currentBalance = totalIncreases - totalDiscounts - totalAdvances;

      // Validar se o novo item fará o saldo ficar negativo
      let newBalance = currentBalance;
      if (type === 'DISCOUNT' || type === 'ADVANCE') {
        newBalance = currentBalance - amount;
      } else if (type === 'INCREASE') {
        newBalance = currentBalance + amount;
      }

      if (newBalance < 0) {
        throw new BadRequestException(
          `O saldo não pode ficar negativo. Saldo disponível: R$ ${(currentBalance / 100).toFixed(2)}`,
        );
      }

      const payrollItem = await this.prisma.payrollItem.create({
        data: {
          payrollId,
          type,
          amount,
          description,
        },
      });
      if (type === 'ADVANCE') {
        // Para adiantamentos, criar despesa específica E atualizar despesa principal de salário
        await this.expenseService.createAdvanceExpense(payroll, amount, description);
        await this.expenseService.updateSalaryExpense(payroll); // Reduz o salário principal
        this.logger.log(
          `Adiantamento criado para folha ${payrollId}, valor: ${amount} - Despesas sincronizadas`,
        );
      } else if (type === 'INCREASE' || type === 'DISCOUNT') {
        // Para acréscimos e descontos, atualizar a despesa de salário
        await this.expenseService.updateSalaryExpense(payroll);
        this.logger.log(
          `Item ${type} adicionado à folha ${payrollId} - Despesa de salário sincronizada`,
        );
      }

      return payrollItem;
    } catch (error) {
      this.logger.error('Erro ao criar movimento de pagamento', error.stack);
      // Se for BadRequestException ou NotFoundException, propagar a mensagem original
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadRequestException('Erro ao criar item de pagamento.');
    }
  }

  async updateSalaryItem(
    itemId: string,
    updateSalaryItemDto: UpdateSalaryItemDto,
  ) {
    const itemData = updateSalaryItemDto;

    const payrollItem = await this.prisma.payrollItem.findUnique({
      where: { id: itemId },
    });
    if (!payrollItem) {
      throw new NotFoundException('Item de folha de pagamento não encontrado.');
    }

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollItem.payrollId },
    });

    if (!payroll || payroll.status !== 'OPEN') {
      throw new NotFoundException(
        'Folha de pagamento não encontrada ou não está aberta.',
      );
    }

    // Armazenar valor antigo para possível sincronização de adiantamentos
    const oldAmount = payrollItem.amount;
    const oldType = payrollItem.type;

    // Buscar todos os itens da folha exceto o que está sendo atualizado
    const currentItems = await this.prisma.payrollItem.findMany({
      where: {
        payrollId: payrollItem.payrollId,
        id: { not: itemId },
      },
    });

    const totalIncreases = currentItems
      .filter((item) => item.type === 'INCREASE')
      .reduce((sum, item) => sum + item.amount, 0);

    const totalDiscounts = currentItems
      .filter((item) => item.type === 'DISCOUNT')
      .reduce((sum, item) => sum + item.amount, 0);

    const totalAdvances = currentItems
      .filter((item) => item.type === 'ADVANCE')
      .reduce((sum, item) => sum + item.amount, 0);

    // Calcular o saldo sem o item que está sendo atualizado
    const currentBalance = totalIncreases - totalDiscounts - totalAdvances;

    // Aplicar a atualização ao saldo
    const newType = itemData.type ?? payrollItem.type;
    const newAmount = itemData.amount ?? payrollItem.amount;

    let newBalance = currentBalance;
    if (newType === 'DISCOUNT' || newType === 'ADVANCE') {
      newBalance = currentBalance - newAmount;
    } else if (newType === 'INCREASE') {
      newBalance = currentBalance + newAmount;
    }

    if (newBalance < 0) {
      throw new BadRequestException('O saldo não pode ficar negativo');
    }

    const updatedSalaryItem = await this.prisma.payrollItem.update({
      where: { id: itemId },
      data: itemData,
    });

    // Sincronizar despesas após atualização

    if (oldType === 'ADVANCE' || newType === 'ADVANCE') {
      // Se era ou virou adiantamento, atualizar despesa de adiantamento
      await this.expenseService.updateAdvanceExpense(updatedSalaryItem, oldAmount);
    }

    // SEMPRE atualizar a despesa principal quando houver alterações
    // pois todos os tipos afetam o cálculo final do salário líquido
    await this.expenseService.updateSalaryExpense(payroll);
    this.logger.log(
      `Item ${updatedSalaryItem.id} atualizado na folha ${payroll.id} - Despesas sincronizadas`,
    );

    return updatedSalaryItem;
  }

  async deleteSalaryItem(itemId: string) {
    const payrollItem = await this.prisma.payrollItem.findUnique({
      where: { id: itemId },
    });

    if (!payrollItem) {
      throw new NotFoundException('Item de folha de pagamento não encontrado.');
    }

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollItem.payrollId },
    });

    if (!payroll || payroll.status !== 'OPEN') {
      throw new BadRequestException(
        'Folha de pagamento não encontrada ou não está aberta.',
      );
    }

    // Para adiantamentos, verificar se o payable associado já foi pago
    if (payrollItem.type === 'ADVANCE') {
      const advanceDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${payrollItem.description}`;

      const advancePayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          description: advanceDescription,
        },
        include: {
          installments: true,
        },
      });

      if (advancePayable) {
        const hasPaidInstallment = advancePayable.installments.some(
          (installment) => installment.status === 'PAID',
        );

        if (hasPaidInstallment) {
          throw new BadRequestException(
            'Não é possível excluir este adiantamento. O pagamento já foi realizado. Estorne o pagamento antes de excluir.',
          );
        }
      }
    }

    // Excluir o item
    await this.prisma.payrollItem.delete({
      where: { id: itemId },
    });

    // Sincronizar despesas
    if (payrollItem.type === 'ADVANCE') {
      // Excluir a despesa do adiantamento
      await this.expenseService.deleteAdvanceExpense(
        payroll,
        payrollItem.description,
      );
      // Atualizar a despesa principal do salário (que inclui o desconto do adiantamento)
      await this.expenseService.updateSalaryExpense(payroll);
      this.logger.log(
        `Adiantamento ${itemId} excluído da folha ${payroll.id} - Despesas sincronizadas`,
      );
    } else {
      // Para INCREASE e DISCOUNT, apenas recalcular a despesa principal
      await this.expenseService.updateSalaryExpense(payroll);
      this.logger.log(
        `Item ${payrollItem.type} ${itemId} excluído da folha ${payroll.id} - Despesa de salário sincronizada`,
      );
    }

    return { success: true, message: 'Item excluído com sucesso.' };
  }

  async toggleSalarySheetStatus(dto: ToggleSalarySheetStatusDto) {
    const { payrollId, status } = dto;

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      select: {
        id: true,
        status: true,
        employeeId: true,
        month: true,
        year: true,
        companyId: true,
      },
    });

    if (!payroll) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    if (payroll.status === status) {
      throw new BadRequestException(`A folha já está no estado ${status}.`);
    }

    // Se está tentando reabrir folha, validar se o salário principal não está pago ou provisionado
    if (status === 'OPEN') {
      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const salaryDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - Salário`;

      // Buscar a despesa de salário principal
      const salaryPayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          financialType: 'MAIN',
          description: salaryDescription,
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          installments: true,
        },
      });

      // Verificar se há parcelas pagas ou provisionadas
      if (salaryPayable) {
        const hasPaidOrProvisioned = salaryPayable.installments.some(
          (installment) =>
            installment.status === 'PAID' ||
            installment.status === 'PROVISIONED',
        );

        if (hasPaidOrProvisioned) {
          throw new BadRequestException(
            'Não é possível reabrir a folha de pagamento. O salário já foi pago.',
          );
        }
      }
    }

    const updatedSalarySheet = await this.prisma.payroll.update({
      where: { id: payrollId },
      data: { status },
    });

    return updatedSalarySheet;
  }

  async getSalarySheetPdfData(id: string) {
    return this.pdfService.getSalarySheetPdfData(id);
  }

  async getAdvanceItemPdfData(itemId: string) {
    return this.pdfService.getAdvanceItemPdfData(itemId);
  }
}

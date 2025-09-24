import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { GetSalarySheetsDto } from './dto/salaries-filters.dto';
import { AddSalaryItemDto } from './dto/create-salary.dto';
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
          await this.createSalaryExpense(payroll, expenseAmount);
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
              paymentMethod: installment.paymentMethod
                ? {
                    id: installment.paymentMethod.id,
                    name: installment.paymentMethod.name,
                  }
                : null,
              value: installment.amount || 0,
              additionalFee: installment.additionalFee || 0,
              dueDate: installment.dueDate || null,
              paidValue: installment.paidAmount || 0,
              paymentDate: installment.paidDate || null,
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

  async addSalaryItem(addSalaryItemDto: AddSalaryItemDto) {
    try {
      const { payrollId, type, amount, description } = addSalaryItemDto;

      const payroll = await this.prisma.payroll.findUnique({
        where: { id: payrollId },
      });

      if (!payroll || payroll.status !== 'OPEN') {
        throw new NotFoundException(
          'Folha de pagamento não encontrada ou não está aberta.',
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
        await this.createAdvanceExpense(payroll, amount, description);
        await this.updateSalaryExpense(payroll); // Reduz o salário principal
        this.logger.log(
          `Adiantamento criado para folha ${payrollId}, valor: ${amount} - Despesas sincronizadas`,
        );
      } else if (type === 'INCREASE' || type === 'DISCOUNT') {
        // Para acréscimos e descontos, atualizar a despesa de salário
        await this.updateSalaryExpense(payroll);
        this.logger.log(
          `Item ${type} adicionado à folha ${payrollId} - Despesa de salário sincronizada`,
        );
      }

      return payrollItem;
    } catch (error) {
      console.error('Error creating payment movement:', error.message);
      throw new BadRequestException('Erro ao criar item de pagamento.');
    }
  }

  async updateSalaryItem(updateSalaryItemDto: UpdateSalaryItemDto) {
    const { id, ...itemData } = updateSalaryItemDto;

    const payrollItem = await this.prisma.payrollItem.findUnique({
      where: { id },
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

    const updatedSalaryItem = await this.prisma.payrollItem.update({
      where: { id },
      data: itemData,
    });

    // Sincronizar despesas após atualização
    const newType = updatedSalaryItem.type;

    if (oldType === 'ADVANCE' || newType === 'ADVANCE') {
      // Se era ou virou adiantamento, atualizar despesa de adiantamento
      await this.updateAdvanceExpense(updatedSalaryItem, oldAmount);
    }

    // SEMPRE atualizar a despesa principal quando houver alterações
    // pois todos os tipos afetam o cálculo final do salário líquido
    await this.updateSalaryExpense(payroll);
    this.logger.log(
      `Item ${updatedSalaryItem.id} atualizado na folha ${payroll.id} - Despesas sincronizadas`,
    );

    return updatedSalaryItem;
  }

  async toggleSalarySheetStatus(dto: ToggleSalarySheetStatusDto) {
    const { payrollId, status } = dto;

    const payroll = await this.prisma.payroll.findUnique({
      where: { id: payrollId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!payroll) {
      throw new NotFoundException('Folha de pagamento não encontrada.');
    }

    if (payroll.status === status) {
      throw new BadRequestException(`A folha já está no estado ${status}.`);
    }

    const updatedSalarySheet = await this.prisma.payroll.update({
      where: { id: payrollId },
      data: { status },
    });

    return updatedSalarySheet;
  }

  private async createSalaryExpense(payroll: any, netAmount: number) {
    try {
      // Se o valor for negativo, não criar despesa
      if (netAmount < 0) {
        this.logger.log(
          `Despesa de salário não criada (valor negativo): R$ ${(netAmount / 100).toFixed(2)}`,
        );
        return null;
      }

      // Competência: primeiro dia do mês da folha
      // Esta data é importante para exibir o Salário e Adiantamento na movimentação da folha do mês correto, já que não existe relacionamento direto do financeiro com folha específica.
      // Se posteriormente essa data de competência for alterada, pode perder a relação com o mês da folha, causando confusão.
      const referenceDate = new Date(payroll.year, payroll.month, 1);

      // Vencimento: dia 5 do mês da folha
      const dueDate = new Date(payroll.year, payroll.month, 5);

      // Buscar categorias de salário
      const { natureId, subCategoryId } = await this.findSalaryCategories(
        payroll.companyId,
      );

      // Criar conta a pagar (despesa) para o salário líquido
      const payable = await this.prisma.payable.create({
        data: {
          referenceDate: referenceDate,
          description: `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - Salário`,
          totalAmount: netAmount,
          totalValue: netAmount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: payroll.companyId,
          expenseSource: 'EMPLOYEE',
          employeeId: payroll.employeeId,
          natureId,
          subCategoryId,
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
    payroll: any,
    amount: number,
    description: string,
  ) {
    try {
      const currentDate = new Date();

      // Usar a data de referência da folha (mês/ano da folha)
      const referenceDate = new Date(payroll.year, payroll.month, 1);

      // Buscar categorias de salário
      const { natureId, subCategoryId } = await this.findSalaryCategories(
        payroll.companyId,
      );

      // Criar conta a pagar (despesa) para o adiantamento
      const payable = await this.prisma.payable.create({
        data: {
          referenceDate,
          description: `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${description}`,
          totalAmount: amount,
          totalValue: amount,
          mainAdditionalFee: 0,
          installmentQty: 1,
          status: 'PENDING',
          companyId: payroll.companyId,
          expenseSource: 'EMPLOYEE',
          financialType: 'ADVANCE',
          employeeId: payroll.employeeId,
          natureId,
          subCategoryId,
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

  private async findSalaryCategories(companyId: string) {
    try {
      // Buscar natureza "Colaboradores / RH"
      const nature = await this.prisma.nature.findFirst({
        where: {
          companyId,
          isActive: true,
          description: {
            contains: 'Colaboradores',
            mode: 'insensitive',
          },
        },
      });

      if (!nature) {
        this.logger.warn(
          `Natureza "Colaboradores / RH" não encontrada para empresa ${companyId}`,
        );
        return {
          natureId: null,
          subCategoryId: null,
        };
      }

      // Buscar subcategoria "Salários" que pertence à natureza encontrada
      const subCategory = await this.prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id, // Garantir que pertence à natureza correta
          description: {
            contains: 'Salários',
            mode: 'insensitive',
          },
        },
      });

      if (!subCategory) {
        this.logger.warn(
          `Subcategoria "Salários" não encontrada para natureza "${nature.description}" na empresa ${companyId}`,
        );
      }

      return {
        natureId: nature.id,
        subCategoryId: subCategory?.id || null,
      };
    } catch (error) {
      this.logger.warn(
        `Erro ao buscar categorias de salário: ${error.message}`,
      );
      return {
        natureId: null,
        subCategoryId: null,
      };
    }
  }

  private async updateSalaryExpense(payroll: any) {
    try {
      const salaryDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - Salário`;

      // Buscar a despesa de salário existente
      const existingSalaryPayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          description: salaryDescription,
        },
        include: {
          installments: true,
        },
      });

      if (existingSalaryPayable) {
        // Calcular novo valor líquido da folha atual
        const currentItems = await this.prisma.payrollItem.findMany({
          where: { payrollId: payroll.id },
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

        // Salário líquido final a pagar = Acréscimos - Descontos - Adiantamentos
        const newNetSalary = totalIncreases - totalDiscounts - totalAdvances;

        // Para salários negativos, a despesa deve ser 0
        const expenseAmount = newNetSalary < 0 ? 0 : newNetSalary;

        // Atualizar a despesa e sua parcela se o valor mudou
        if (
          expenseAmount !== existingSalaryPayable.totalAmount &&
          expenseAmount >= 0
        ) {
          await this.prisma.$transaction(async (prisma) => {
            // Atualizar a despesa principal
            await prisma.payable.update({
              where: { id: existingSalaryPayable.id },
              data: {
                totalAmount: expenseAmount,
                totalValue: expenseAmount,
              },
            });

            // Atualizar a parcela única
            if (existingSalaryPayable.installments.length > 0) {
              await prisma.payableInstallment.update({
                where: { id: existingSalaryPayable.installments[0].id },
                data: {
                  amount: expenseAmount,
                },
              });
            }
          });

          this.logger.log(
            `Despesa de salário atualizada: ${existingSalaryPayable.id} - Novo valor: R$ ${(expenseAmount / 100).toFixed(2)}`,
          );
        } else if (expenseAmount < 0) {
          // Se o valor da despesa ficou negativo, remover a despesa
          await this.prisma.payable.delete({
            where: { id: existingSalaryPayable.id },
          });

          this.logger.log(
            `Despesa de salário removida (valor da despesa negativo): ${existingSalaryPayable.id}`,
          );
        }
      } else {
        // Se não existe despesa, calcular o valor líquido atual
        const currentItems = await this.prisma.payrollItem.findMany({
          where: { payrollId: payroll.id },
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

        // Salário líquido final a pagar = Acréscimos - Descontos - Adiantamentos
        const newNetSalary = totalIncreases - totalDiscounts - totalAdvances;

        // Para salários negativos, a despesa deve ser 0
        const expenseAmount = newNetSalary < 0 ? 0 : newNetSalary;

        if (expenseAmount >= 0) {
          // Se não existe despesa mas deveria ter (valor da despesa >= 0), criar
          await this.createSalaryExpense(payroll, expenseAmount);
        }
      }
    } catch (error) {
      this.logger.error(
        `Erro ao atualizar despesa de salário: ${error.message}`,
      );
      // Não propaga o erro para não bloquear a operação principal
    }
  }

  private async updateAdvanceExpense(payrollItem: any, oldAmount?: number) {
    try {
      if (payrollItem.type !== 'ADVANCE') {
        return;
      }

      const payroll = await this.prisma.payroll.findUnique({
        where: { id: payrollItem.payrollId },
      });

      if (!payroll) {
        return;
      }

      const advanceDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${payrollItem.description}`;

      // Buscar a despesa de adiantamento existente
      const existingAdvancePayable = await this.prisma.payable.findFirst({
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

      if (existingAdvancePayable && oldAmount !== undefined) {
        // Atualizar despesa existente
        await this.prisma.$transaction(async (prisma) => {
          await prisma.payable.update({
            where: { id: existingAdvancePayable.id },
            data: {
              totalAmount: payrollItem.amount,
              totalValue: payrollItem.amount,
            },
          });

          if (existingAdvancePayable.installments.length > 0) {
            await prisma.payableInstallment.update({
              where: { id: existingAdvancePayable.installments[0].id },
              data: {
                amount: payrollItem.amount,
              },
            });
          }
        });

        this.logger.log(
          `Despesa de adiantamento atualizada: ${existingAdvancePayable.id} - Novo valor: R$ ${(payrollItem.amount / 100).toFixed(2)}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Erro ao atualizar despesa de adiantamento: ${error.message}`,
      );
    }
  }

  async getSalarySheetPdfData(id: string) {
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
          company: {
            include: {
              address: {
                where: { type: 'Principal' },
              },
            },
          },
          items: {
            orderBy: [
              {
                createdAt: 'asc',
              },
              {
                id: 'asc', // Desempate por ID para manter ordem consistente
              },
            ],
          },
        },
      });

      if (!payroll) {
        throw new NotFoundException('Folha de pagamento não encontrada');
      }

      // Buscar dados da empresa
      const companyAddress = payroll.company.address[0];

      // Calcular salário líquido
      const totalIncreases = payroll.items
        .filter((item) => item.type === 'INCREASE')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalDiscounts = payroll.items
        .filter((item) => item.type === 'DISCOUNT')
        .reduce((sum, item) => sum + item.amount, 0);

      const totalAdvances = payroll.items
        .filter((item) => item.type === 'ADVANCE')
        .reduce((sum, item) => sum + item.amount, 0);

      const netSalary = totalIncreases - totalDiscounts - totalAdvances;

      // Buscar despesas do colaborador específicas do mês/ano da folha
      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const relatedPayables = await this.prisma.payable.findMany({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          financialType: 'MAIN',
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          installments: {
            include: {
              paymentMethod: true,
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      // Estruturar dados para o PDF
      const pdfData = {
        company: {
          name: payroll.company.name,
          cnpj: payroll.company.cnpj,
          email: payroll.company.email,
          phone: payroll.company.phone,
          siteUrl: payroll.company.siteUrl,
          logo: payroll.company.logoUrl,
          socialNetworks: {
            instagram: payroll.company.instagram,
            facebook: payroll.company.facebook,
            linkedin: payroll.company.linkedin,
          },
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                complement: companyAddress.complement,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
                zipCode: companyAddress.zipcode,
              }
            : null,
        },
        employeeName: payroll.employee.user?.name || payroll.employee.name,
        reference: `${String(payroll.month + 1).padStart(2, '0')}/${payroll.year}`,
        items: payroll.items.map((item) => ({
          id: item.id,
          description: item.description,
          type: item.type,
          amount: item.amount,
        })),
        netSalary,
        payables: relatedPayables.map((payable) => ({
          id: payable.id,
          description: payable.description,
          totalAmount: payable.totalAmount,
          installments: payable.installments.map((installment) => ({
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
          })),
        })),
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

  async getAdvanceItemPdfData(itemId: string) {
    try {
      const payrollItem = await this.prisma.payrollItem.findUnique({
        where: { id: itemId },
        include: {
          payroll: {
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
            },
          },
        },
      });

      if (!payrollItem) {
        throw new NotFoundException(
          'Item da folha de pagamento não encontrado',
        );
      }

      if (payrollItem.type !== 'ADVANCE') {
        throw new BadRequestException(
          'O item especificado não é um adiantamento',
        );
      }

      const payroll = payrollItem.payroll;
      const companyAddress = payroll.company.address[0];

      // Buscar despesa relacionada ao adiantamento específico
      const startDate = new Date(payroll.year, payroll.month, 1);
      const endDate = new Date(payroll.year, payroll.month + 1, 0);

      const advanceDescription = `Folha ${String(payroll.month + 1).padStart(2, '0')}/${payroll.year} - ${payrollItem.description}`;

      const relatedPayable = await this.prisma.payable.findFirst({
        where: {
          companyId: payroll.companyId,
          employeeId: payroll.employeeId,
          expenseSource: 'EMPLOYEE',
          financialType: 'ADVANCE',
          description: advanceDescription,
          referenceDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          installments: {
            include: {
              paymentMethod: true,
            },
            orderBy: {
              installmentNumber: 'asc',
            },
          },
        },
      });

      // Estruturar dados para o PDF
      const pdfData = {
        company: {
          name: payroll.company.name,
          cnpj: payroll.company.cnpj,
          email: payroll.company.email,
          phone: payroll.company.phone,
          siteUrl: payroll.company.siteUrl,
          logo: payroll.company.logoUrl,
          socialNetworks: {
            instagram: payroll.company.instagram,
            facebook: payroll.company.facebook,
            linkedin: payroll.company.linkedin,
          },
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                complement: companyAddress.complement,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
                zipCode: companyAddress.zipcode,
              }
            : null,
        },
        employeeName: payroll.employee.user?.name || payroll.employee.name,
        reference: `${String(payroll.month + 1).padStart(2, '0')}/${payroll.year}`,
        items: [
          {
            id: payrollItem.id,
            description: payrollItem.description,
            type: payrollItem.type,
            amount: payrollItem.amount,
          },
        ],
        netSalary: payrollItem.amount, // Total do adiantamento
        payables: relatedPayable
          ? [
              {
                id: relatedPayable.id,
                description: relatedPayable.description,
                totalAmount: relatedPayable.totalAmount,
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
                  }),
                ),
              },
            ]
          : [],
      };

      return pdfData;
    } catch (error) {
      this.logger.error(
        `Erro ao gerar dados do PDF de adiantamento: ${error.message}`,
      );
      throw new BadRequestException(
        'Erro ao gerar dados do PDF de adiantamento',
      );
    }
  }
}

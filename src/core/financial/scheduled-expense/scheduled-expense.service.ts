import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateScheduledExpenseDto,
  LaunchScheduledExpenseDto,
  ScheduledExpenseFilterDto,
} from './dto/create-scheduled-expense.dto';
import { UpdateScheduledExpenseDto } from './dto/update-scheduled-expense.dto';
import { PrismaService } from 'nestjs-prisma';
import { assertFinancialRefsOfCompany } from '../utils/financial-refs';

@Injectable()
export class ScheduledExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduledExpenseDto, companyId: string) {
    // Fornecedor, natureza e subcategoria precisam ser da empresa (a resposta
    // trazia o fornecedor de outra empresa completo, e o lançamento levava o
    // vínculo para as contas a pagar)
    await assertFinancialRefsOfCompany(this.prisma, companyId, {
      supplierId: dto.supplierId,
      natureId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
    });

    try {
      return await this.prisma.scheduledExpense.create({
        data: {
          amount: dto.amount,
          description: dto.description,
          dueDay: dto.dueDay,
          recurringType: dto.recurringType,
          supplierId: dto.supplierId,
          categoryId: dto.categoryId,
          subCategoryId: dto.subCategoryId,
          isActive: dto.isActive ?? true,
          companyId,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });
    } catch (error) {
      throw new BadRequestException(
        `Error creating scheduled expense: ${error.message}`,
      );
    }
  }

  async findAll(filter: ScheduledExpenseFilterDto, companyId: string) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        supplierId,
        categoryId,
        recurringType,
        status,
        level1,
        level2,
        natureCode,
      } = filter;

      const where: any = {
        companyId,
      };

      // Filtro de busca por descrição
      if (search) {
        where.description = {
          contains: search,
          mode: 'insensitive',
        };
      }

      // Filtro por fornecedor
      if (supplierId) {
        where.supplierId = supplierId;
      }

      // Filtro por categoria
      if (categoryId) {
        where.categoryId = categoryId;
      }

      // Filtro por tipo de recorrência
      if (recurringType) {
        where.recurringType = recurringType;
      }

      // Filtro por status
      if (status) {
        where.isActive = status === 'ACTIVE';
      }

      // Filtros por natureza (level1, level2, natureCode)
      if (level1 || level2 || natureCode) {
        where.nature = {
          ...(level1 && { level1 }),
          ...(level2 && { level2 }),
          ...(natureCode && { code: natureCode }),
        };
      }

      const [total, data] = await Promise.all([
        this.prisma.scheduledExpense.count({ where }),
        this.prisma.scheduledExpense.findMany({
          where,
          include: {
            supplier: true,
            company: true,
            subCategory: true,
            payables: {
              include: {
                installments: {
                  select: {
                    status: true,
                    dueDate: true,
                    paidDate: true,
                  },
                },
              },
            },
          },
          take: +limit,
          skip: (+page - 1) * +limit,
          orderBy: { description: 'asc' },
        }),
      ]);

      // Processar os dados para incluir informações de lançamento
      const processedData = data.map((expense) => {
        const hasLaunches = expense.payables.length > 0;
        const launchStatus = hasLaunches ? 'LAUNCHED' : 'NOT_LAUNCHED';

        // Contar lançamentos por status
        const launchSummary = {
          total: expense.payables.length,
          pending: expense.payables.filter((p) =>
            p.installments.some((i) => i.status === 'PENDING'),
          ).length,
          paid: expense.payables.filter((p) =>
            p.installments.every((i) => i.status === 'PAID'),
          ).length,
        };

        return {
          ...expense,
          launchStatus,
          launchSummary,
        };
      });

      return {
        total,
        totalPages: Math.ceil(total / +limit),
        data: processedData,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding scheduled expenses: ${error.message}`,
      );
    }
  }

  async findOne(id: string, companyId: string) {
    try {
      const expense = await this.prisma.scheduledExpense.findFirst({
        where: {
          id,
          companyId,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });

      if (!expense) {
        throw new NotFoundException(
          `Scheduled expense with ID ${id} not found`,
        );
      }

      return expense;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error finding scheduled expense: ${error.message}`,
      );
    }
  }

  async update(id: string, dto: UpdateScheduledExpenseDto, companyId: string) {
    await assertFinancialRefsOfCompany(this.prisma, companyId, {
      supplierId: dto.supplierId,
      natureId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
    });

    try {
      const expense = await this.findOne(id, companyId);

      return await this.prisma.scheduledExpense.update({
        where: {
          id: expense.id,
        },
        data: {
          amount: dto.amount,
          description: dto.description,
          dueDay: dto.dueDay,
          recurringType: dto.recurringType,
          supplierId: dto.supplierId,
          categoryId: dto.categoryId,
          subCategoryId: dto.subCategoryId,
          isActive: dto.isActive,
        },
        include: {
          supplier: true,
          company: true,
          subCategory: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error updating scheduled expense: ${error.message}`,
      );
    }
  }

  async remove(id: string, companyId: string) {
    try {
      const expense = await this.findOne(id, companyId);

      return await this.prisma.scheduledExpense.delete({
        where: {
          id: expense.id,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(
        `Error removing scheduled expense: ${error.message}`,
      );
    }
  }

  async count(companyId: string) {
    try {
      const allStatuses = ['ACTIVE', 'INACTIVE'];

      const result = await this.prisma.scheduledExpense.groupBy({
        by: ['isActive'],
        where: { companyId },
        _count: true,
      });

      const statusCount = allStatuses.reduce(
        (acc, status) => {
          acc[status] = 0;
          return acc;
        },
        {} as { [key: string]: number },
      );

      result.forEach((cur) => {
        const status = cur.isActive ? 'ACTIVE' : 'INACTIVE';
        statusCount[status] = cur._count;
      });

      const total = Object.values(statusCount).reduce(
        (acc, cur) => acc + cur,
        0,
      );

      return {
        ...statusCount,
        TOTAL: total,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error counting scheduled expenses: ${error.message}`,
      );
    }
  }

  async findAllByLevel1(companyId: string, level1: string, status?: string) {
    try {
      const lvl1 = level1 === 'receivable' ? '01' : '02';

      const where: any = {
        companyId,
        nature: {
          level1: lvl1,
          isActive: true,
        },
      };

      if (status) {
        where.isActive = status === 'ACTIVE';
      }

      const [total, data] = await Promise.all([
        this.prisma.scheduledExpense.count({ where }),
        this.prisma.scheduledExpense.findMany({
          where,
          include: {
            supplier: true,
            nature: {
              select: {
                id: true,
                code: true,
                description: true,
                level1: true,
                level2: true,
              },
            },
            subCategory: {
              select: {
                id: true,
                code: true,
                description: true,
              },
            },
          },
          orderBy: {
            description: 'asc',
          },
        }),
      ]);

      return {
        total,
        totalPages: 1,
        data,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding scheduled expenses by level1: ${error.message}`,
      );
    }
  }

  async findAllByLevel2(
    companyId: string,
    level1: string,
    level2: string,
    status?: string,
  ) {
    try {
      const where: any = {
        companyId,
        nature: {
          level1,
          level2,
          isActive: true,
        },
      };

      if (status) {
        where.isActive = status === 'ACTIVE';
      }

      const [total, data] = await Promise.all([
        this.prisma.scheduledExpense.count({ where }),
        this.prisma.scheduledExpense.findMany({
          where,
          include: {
            supplier: true,
            nature: {
              select: {
                id: true,
                code: true,
                description: true,
                level1: true,
                level2: true,
              },
            },
            subCategory: {
              select: {
                id: true,
                code: true,
                description: true,
              },
            },
          },
          orderBy: {
            description: 'asc',
          },
        }),
      ]);

      return {
        total,
        totalPages: 1,
        data,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding scheduled expenses by level2: ${error.message}`,
      );
    }
  }

  async findAllByNatureCode(
    companyId: string,
    natureCode: string,
    status?: string,
  ) {
    try {
      const where: any = {
        companyId,
        nature: {
          code: natureCode,
          isActive: true,
        },
      };

      if (status) {
        where.isActive = status === 'ACTIVE';
      }

      const [total, data] = await Promise.all([
        this.prisma.scheduledExpense.count({ where }),
        this.prisma.scheduledExpense.findMany({
          where,
          include: {
            supplier: true,
            nature: {
              select: {
                id: true,
                code: true,
                description: true,
                level1: true,
                level2: true,
              },
            },
            subCategory: {
              select: {
                id: true,
                code: true,
                description: true,
              },
            },
          },
          orderBy: {
            description: 'asc',
          },
        }),
      ]);

      return {
        total,
        totalPages: 1,
        data,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding scheduled expenses by nature code: ${error.message}`,
      );
    }
  }

  async findAllGroupedBySupplier(
    filters: ScheduledExpenseFilterDto,
    companyId: string,
  ) {
    try {
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 10;
      const skip = (page - 1) * limit;
      // month já vem no formato 0-11 do DTO
      const adjustedMonth =
        filters.month !== undefined ? filters.month : new Date().getMonth();
      const year = filters.year || new Date().getFullYear();
      // Para retornar no response (formato 1-12 para exibição)
      const month = adjustedMonth + 1;

      // Buscar fornecedores que têm despesas agendadas
      const whereSupplier: any = {
        companyId,
        scheduledExpense: {
          some: {
            companyId,
          },
        },
      };

      // Filtro por busca de fornecedor
      if (filters.search) {
        whereSupplier.name = {
          contains: filters.search,
          mode: 'insensitive',
        };
      }

      // Condições para as despesas agendadas
      const whereScheduledExpense: any = {
        companyId,
      };

      if (filters.status) {
        whereScheduledExpense.isActive = filters.status === 'ACTIVE';
      } else {
        // Se não houver filtro de status, mostrar apenas despesas ativas
        // OU despesas inativas que já foram lançadas no período
        whereScheduledExpense.OR = [
          { isActive: true },
          {
            isActive: false,
            payables: {
              some: {
                referenceDate: {
                  gte: new Date(year, adjustedMonth, 1),
                  lt: new Date(year, adjustedMonth + 1, 1),
                },
              },
            },
          },
        ];
      }

      if (filters.level1) {
        const lvl1 = filters.level1 === 'receivable' ? '01' : '02';
        whereScheduledExpense.nature = {
          level1: lvl1,
          isActive: true,
        };
      }

      if (filters.level2) {
        whereScheduledExpense.nature = {
          ...whereScheduledExpense.nature,
          level2: filters.level2,
        };
      }

      if (filters.natureCode) {
        whereScheduledExpense.nature = {
          ...whereScheduledExpense.nature,
          code: filters.natureCode,
        };
      }

      // Filtro por payables do mês/ano especificado
      const wherePayables: any = {
        scheduledExpenseId: { not: null },
        referenceDate: {
          gte: new Date(year, adjustedMonth, 1),
          lt: new Date(year, adjustedMonth + 1, 1),
        },
      };

      const [suppliers, total] = await Promise.all([
        this.prisma.supplier.findMany({
          where: whereSupplier,
          include: {
            scheduledExpense: {
              where: whereScheduledExpense,
              include: {
                nature: {
                  select: {
                    id: true,
                    code: true,
                    description: true,
                    level1: true,
                    level2: true,
                  },
                },
                subCategory: {
                  select: {
                    id: true,
                    code: true,
                    description: true,
                  },
                },
                payables: {
                  where: wherePayables,
                  include: {
                    installments: {
                      select: {
                        status: true,
                        dueDate: true,
                        paidDate: true,
                      },
                    },
                  },
                },
              },
              orderBy: {
                dueDay: 'asc',
              },
            },
          },
          skip,
          take: limit,
          orderBy: {
            name: 'asc',
          },
        }),
        this.prisma.supplier.count({ where: whereSupplier }),
      ]);

      // Calcular totais por fornecedor
      const data = suppliers.map((supplier) => {
        const activeExpenses = supplier.scheduledExpense.filter(
          (exp) => exp.isActive,
        );
        const inactiveExpenses = supplier.scheduledExpense.filter(
          (exp) => !exp.isActive,
        );
        const totalAmount = supplier.scheduledExpense.reduce(
          (sum, exp) => sum + exp.amount,
          0,
        );

        // Processar cada despesa programada para incluir informações de lançamento
        const processedItems = supplier.scheduledExpense.map((expense) => {
          const hasLaunches = expense.payables.length > 0;
          const launchStatus = hasLaunches ? 'LAUNCHED' : 'NOT_LAUNCHED';

          // Contar lançamentos por status
          const launchSummary = {
            total: expense.payables.length,
            pending: expense.payables.filter((p) =>
              p.installments.some((i) => i.status === 'PENDING'),
            ).length,
            paid: expense.payables.filter((p) =>
              p.installments.every((i) => i.status === 'PAID'),
            ).length,
          };

          return {
            ...expense,
            launchStatus,
            launchSummary,
          };
        });

        // Calcular totais de lançamentos para o fornecedor
        const totalLaunched = processedItems.filter(
          (item) => item.launchStatus === 'LAUNCHED',
        ).length;
        const totalNotLaunched = processedItems.filter(
          (item) => item.launchStatus === 'NOT_LAUNCHED',
        ).length;

        return {
          id: supplier.id,
          name: supplier.name,
          email: supplier.email,
          phone: supplier.phone,
          month,
          year,
          totalExpenses: supplier.scheduledExpense.length,
          activeExpenses: activeExpenses.length,
          inactiveExpenses: inactiveExpenses.length,
          totalAmount,
          totalLaunched,
          totalNotLaunched,
          items: processedItems,
        };
      });

      return {
        total,
        totalPages: Math.ceil(total / limit),
        data,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error finding grouped scheduled expenses: ${error.message}`,
      );
    }
  }

  async launchScheduledExpenses(
    launchData: LaunchScheduledExpenseDto,
    companyId: string,
  ) {
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // Verifica se foram enviados dados customizados (datas e valor)
    const hasCustomData = !!(
      launchData.competenceDate &&
      launchData.dueDate &&
      launchData.amount
    );

    // Define o mês e ano de referência
    const now = new Date();
    // month vem no formato 0-11 (JavaScript padrão), então adiciona +1 para usar no Date
    const referenceMonth =
      launchData.month !== undefined
        ? launchData.month + 1
        : now.getMonth() + 1;
    const referenceYear = launchData.year || now.getFullYear();

    // Buscar conta bancária padrão da empresa uma única vez
    const defaultBankAccount = await this.prisma.bankAccount.findFirst({
      where: {
        companyId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    const defaultBankAccountId = defaultBankAccount?.id || null;

    for (const scheduledExpenseId of launchData.scheduledExpenseIds) {
      try {
        // Buscar a despesa agendada
        const scheduledExpense = await this.findOne(
          scheduledExpenseId,
          companyId,
        );

        let dueDate: Date;
        let competenceDate: Date;
        let amount: number;

        if (hasCustomData) {
          // Usa os dados customizados enviados no request
          dueDate = new Date(launchData.dueDate);
          competenceDate = new Date(launchData.competenceDate);
          amount = launchData.amount;
        } else {
          // Usa os dados da despesa agendada
          const dueDay = scheduledExpense.dueDay;
          const lastDayOfMonth = new Date(
            referenceYear,
            referenceMonth,
            0,
          ).getDate();
          const adjustedDueDay = Math.min(dueDay, lastDayOfMonth);

          // Data de vencimento: dia especificado no mês/ano de referência
          dueDate = new Date(referenceYear, referenceMonth - 1, adjustedDueDay);

          // Data de competência: primeiro dia do mês de referência
          competenceDate = new Date(referenceYear, referenceMonth - 1, 1);

          amount = scheduledExpense.amount;
        }

        const isPaid = launchData.markAsPaid === true;
        const resolvedPaidDate = isPaid
          ? launchData.paidDate
            ? new Date(launchData.paidDate)
            : dueDate
          : null;

        // Criar a conta a pagar baseada na despesa agendada
        const payable = await this.prisma.payable.create({
          data: {
            referenceDate: competenceDate,
            description:
              scheduledExpense.description ||
              `Despesa agendada - ${scheduledExpense.supplier?.name || 'Sem fornecedor'}`,
            notes: launchData.notes,
            totalAmount: amount,
            totalValue: amount,
            mainAdditionalFee: 0,
            installmentQty: 1,
            status: isPaid ? 'PAID' : 'PENDING',
            supplierId: scheduledExpense.supplierId,
            companyId,
            natureId: scheduledExpense.categoryId,
            subCategoryId: scheduledExpense.subCategoryId,
            scheduledExpenseId: scheduledExpenseId,
          },
          include: {
            supplier: true,
            nature: true,
            subCategory: true,
          },
        });

        // Criar a parcela única
        const installment = await this.prisma.payableInstallment.create({
          data: {
            payableId: payable.id,
            installmentNumber: 1,
            dueDate: dueDate,
            amount: amount,
            additionalFee: 0,
            paymentConditionId: null,
            bankAccountId: defaultBankAccountId,
            status: isPaid ? 'PAID' : 'PENDING',
            paidDate: resolvedPaidDate,
            paidAmount: isPaid ? amount : null,
          },
        });

        results.push({
          scheduledExpenseId,
          success: true,
          payable,
          installment,
        });
        successCount++;
      } catch (error) {
        results.push({
          scheduledExpenseId,
          success: false,
          error: error.message,
        });
        errorCount++;
      }
    }

    return {
      success: errorCount === 0,
      message: `${successCount} despesa(s) lançada(s) com sucesso${errorCount > 0 ? `, ${errorCount} com erro` : ''}`,
      results,
    };
  }
}

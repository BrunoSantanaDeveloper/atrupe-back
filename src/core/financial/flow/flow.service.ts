import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { FinancialFlowFilterDTO } from './dto/filter.dto';
import { InstallmentStatusCheck } from '../utils/financial.types';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  constructor(private readonly prisma: PrismaService) {}

  private getActualStatus(installment: InstallmentStatusCheck): string {
    if (
      installment.status === 'PENDING' &&
      new Date(installment.dueDate) < new Date()
    ) {
      return 'OVERDUE';
    }
    return installment.status;
  }

  async findAllTotals(filter: FinancialFlowFilterDTO) {
    const {
      search,
      startDate,
      endDate,
      status,
      paymentConditionId,
      bankAccountId,
      dateType = 'dueDate',
      clientId,
      supplierId,
    } = filter;

    const filtersReceivables: any = {
      receivable: {
        companyId: filter.companyId,
        status: { not: 'CANCELED' },
      },
    };
    const filtersPayables: Record<string, unknown> = {
      payable: {
        companyId: filter.companyId,
        status: { not: 'CANCELED' },
      },
    };

    // Filtro de cliente
    if (clientId) {
      filtersReceivables.receivable = {
        ...filtersReceivables.receivable,
        clientId: clientId,
      };
      filtersPayables.payable = {
        ...filtersPayables.payable,
        clientId: { not: null },
      };
    }

    // Filtro de fornecedor
    if (supplierId) {
      filtersReceivables.receivable = {
        ...filtersReceivables.receivable,
        supplierId: { not: null },
      };
      filtersPayables.payable = {
        ...filtersPayables.payable,
        supplierId: supplierId,
      };
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      filtersReceivables[dateType] = dateFilter;
      filtersPayables[dateType] = dateFilter;
    }

    // Quando filtrando por paidDate, só considerar parcelas que foram pagas
    if (dateType === 'paidDate') {
      filtersReceivables.paidDate = {
        ...filtersReceivables.paidDate,
        not: null,
      };
      filtersPayables.paidDate = {
        ...filtersPayables.paidDate,
        not: null,
      };
    }

    // Filtro de status
    if (status) {
      filtersReceivables.status = status;
      filtersPayables.status = status;
    }

    // Filtro de condição de pagamento
    if (paymentConditionId) {
      filtersReceivables.paymentConditionId = paymentConditionId;
      filtersPayables.paymentConditionId = paymentConditionId;
    }

    if (bankAccountId) {
      filtersReceivables.bankAccountId = bankAccountId;
      filtersPayables.bankAccountId = bankAccountId;
    }

    // Filtro de busca
    if (search) {
      filtersReceivables.OR = [
        {
          receivable: {
            client: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
      filtersPayables.OR = [
        {
          payable: {
            supplier: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    // Obter os detalhes dos recebíveis
    const receivableDetails = await this.prisma.receivableInstallment.findMany({
      where: {
        ...filtersReceivables,
      },
    });

    // Obter os detalhes dos pagáveis
    const payableDetails = await this.prisma.payableInstallment.findMany({
      where: {
        ...filtersPayables,
      },
    });
    // Calcular totais para recebíveis
    const totalReceivables = receivableDetails.reduce(
      (acc, inst) => {
        const expected =
          inst.status !== 'CANCELED'
            ? (inst.amount ?? 0) + (inst.additionalFee ?? 0)
            : 0;
        const totalPaid = inst.paidAmount ?? 0;

        return {
          expected: acc.expected + expected,
          totalPaid: acc.totalPaid + totalPaid,
        };
      },
      { expected: 0, totalPaid: 0 },
    );

    // Calcular totais para pagáveis
    const totalPayables = payableDetails.reduce(
      (acc, inst) => {
        const expected =
          inst.status !== 'CANCELED'
            ? (inst.amount ?? 0) + (inst.additionalFee ?? 0)
            : 0;
        const totalPaid = inst.paidAmount ?? 0;

        return {
          expected: acc.expected + expected,
          totalPaid: acc.totalPaid + totalPaid,
        };
      },
      { expected: 0, totalPaid: 0 },
    );

    return {
      receivables: totalReceivables,
      payables: totalPayables,
    };
  }
  async findAll(paginationDto: FinancialFlowFilterDTO) {
    const {
      page = 1,
      limit = 10,
      search,
      startDate,
      clientId,
      supplierId,
      endDate,
      status,
      paymentConditionId,
      bankAccountId,
      sort = 'desc',
      dateType = 'dueDate',
      showValues = 'on',
    } = paginationDto;

    if (!['dueDate', 'paidDate'].includes(dateType)) {
      throw new BadRequestException(
        'Invalid dateType. Use "dueDate" or "paidDate".',
      );
    }
    const filtersReceivables: any = {
      receivable: {
        companyId: paginationDto.companyId,
      },
    };
    const filtersPayables: any = {
      payable: {
        companyId: paginationDto.companyId,
      },
    };
    if (clientId) {
      filtersReceivables.receivable = {
        ...filtersReceivables.receivable,
        clientId: clientId,
      };
      filtersPayables.payable = {
        ...filtersPayables.payable,
        clientId: { not: null },
      };
    }
    if (supplierId) {
      filtersReceivables.receivable = {
        ...filtersReceivables.receivable,
        supplierId: { not: null },
      };
      filtersPayables.payable = {
        ...filtersPayables.payable,
        supplierId: supplierId,
      };
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }

      filtersReceivables[dateType] = dateFilter;
      filtersPayables[dateType] = dateFilter;
    }

    // Filtro de status
    if (status) {
      filtersReceivables.status = status;
      filtersPayables.status = status;
    }

    // Filtro de condição de pagamento
    if (paymentConditionId) {
      filtersReceivables.paymentConditionId = paymentConditionId;
      filtersPayables.paymentConditionId = paymentConditionId;
    }

    if (bankAccountId) {
      filtersReceivables.bankAccountId = bankAccountId;
      filtersPayables.bankAccountId = bankAccountId;
    }

    // Filtro de busca
    if (search) {
      filtersReceivables.OR = [
        {
          receivable: {
            client: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
      filtersPayables.OR = [
        {
          payable: {
            supplier: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }
    try {
      // Buscar dados agrupados para recebíveis
      const [receivablesGrouped, payablesGrouped] =
        dateType === 'dueDate'
          ? await this.fetchDataDueDate(
              filtersReceivables,
              filtersPayables,
              showValues,
              sort,
            )
          : await this.fetchDataPaidDate(
              filtersReceivables,
              filtersPayables,
              showValues,
              sort,
            );

      // Extrair as datas para busca detalhada
      // Normalizar datas para o início do dia (00:00:00.000) para agrupar corretamente
      const dueDates = [
        ...new Set([
          ...receivablesGrouped.map((g) => {
            if (!g[dateType]) return null;
            const date = new Date(g[dateType]);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }),
          ...payablesGrouped.map((g) => {
            if (!g[dateType]) return null;
            const date = new Date(g[dateType]);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }),
        ]),
      ].filter((d) => d !== null);

      const receivableDetails =
        await this.prisma.receivableInstallment.findMany({
          where: {
            [dateType]: { in: dueDates.map((d) => new Date(d)) },
            ...filtersReceivables,
          },
          orderBy: { [dateType]: sort.toLowerCase() },
          include: {
            receivable: {
              include: {
                client: true,
                nature: true,
                subCategory: true,
                installments: {
                  include: {
                    paymentCondition: true,
                    bankAccount: { include: { bank: true } },
                  },
                  orderBy: { [dateType]: 'desc' },
                },
              },
            },
          },
        });

      const payableDetails = await this.prisma.payableInstallment.findMany({
        where: {
          [dateType]: { in: dueDates.map((d) => new Date(d)) },
          ...filtersPayables,
        },
        orderBy: { [dateType]: sort.toLowerCase() },
        include: {
          payable: {
            include: {
              supplier: true,
              employee: true,
              nature: true,
              subCategory: true,
              installments: {
                include: {
                  paymentCondition: true,
                  bankAccount: { include: { bank: true } },
                },
                orderBy: { [dateType]: 'desc' },
              },
            },
          },
        },
      });

      const groupedData = this.buildFlowGroupedData(
        dueDates,
        receivableDetails,
        payableDetails,
        dateType,
        showValues,
      );

      const total = groupedData.length;
      const lastPage = Math.ceil(total / +limit);

      return {
        total,
        lastPage,
        data: groupedData.slice((+page - 1) * +limit, +page * +limit),
      };
    } catch (error) {
      this.logger.error('Erro ao buscar dados do fluxo financeiro', error.stack);
      throw new InternalServerErrorException(
        'Error fetching financial flow data',
      );
    }
  }

  private buildFlowGroupedData(
    dueDates: string[],
    receivableDetails: any[],
    payableDetails: any[],
    dateType: string,
    showValues: string,
  ) {
    return dueDates.map((date) => {
      const receivables = receivableDetails
        .filter((inst) => {
          if (!inst[dateType]) return false;
          const instDate = new Date(inst[dateType]);
          instDate.setUTCHours(0, 0, 0, 0);
          return instDate.toISOString() === date;
        })
        .map((inst) =>
          this.mapReceivableInstallment(inst, date, dateType, showValues),
        );

      const payables = payableDetails
        .filter((inst) => {
          if (!inst[dateType]) return false;
          const instDate = new Date(inst[dateType]);
          instDate.setUTCHours(0, 0, 0, 0);
          return instDate.toISOString() === date;
        })
        .map((inst) =>
          this.mapPayableInstallment(inst, date, dateType, showValues),
        );

      return {
        date: new Date(date),
        ...(showValues === 'on' && {
          expectedRevenue: receivables.reduce(
            (acc, rec) => acc + rec.expectedRevenue,
            0,
          ),
          expectedExpense: payables.reduce(
            (acc, pay) => acc + pay.expectedExpense,
            0,
          ),
          realizedRevenue: receivables.reduce(
            (acc, rec) => acc + rec.realizedRevenue,
            0,
          ),
          realizedExpense: payables.reduce(
            (acc, pay) => acc + pay.realizedExpense,
            0,
          ),
        }),
        transactions: [...receivables, ...payables],
      };
    });
  }

  private mapReceivableInstallment(
    inst: any,
    date: string,
    dateType: string,
    showValues: string,
  ) {
    const relevantInstallments = inst.receivable.installments.filter((i) => {
      if (!i[dateType]) return false;
      const iDate = new Date(i[dateType]);
      iDate.setUTCHours(0, 0, 0, 0);
      return iDate.toISOString() === date;
    });

    return {
      type: 'receivable',
      id: inst.receivable.id,
      totalValue: inst.receivable?.totalAmount || 0,
      totalPaid: (inst.receivable?.installments || []).reduce(
        (sum, item) => sum + (item.paidAmount ?? 0),
        0,
      ),
      description: inst.receivable.description || '',
      client: inst.receivable.client
        ? {
            id: inst.receivable.client.id,
            name: inst.receivable.client.name,
          }
        : null,
      subCategory: inst.receivable.subCategory
        ? {
            id: inst.receivable.subCategory.id,
            name: inst.receivable.subCategory.description,
          }
        : null,
      nature: inst.receivable.nature
        ? {
            id: inst.receivable.nature.id,
            name: inst.receivable.nature.description,
          }
        : null,
      installmentsQuantity: inst.receivable.installmentQty || 0,
      period: inst.receivable?.referenceDate || null,
      notes: inst.receivable.notes || '',
      status: inst.receivable.status,
      currentInstallment: this.mapCurrentInstallment(inst.receivable, inst.id),
      ...(showValues === 'on' && {
        expectedRevenue: relevantInstallments.reduce(
          (sum, i) =>
            sum +
            (i.status !== 'CANCELED'
              ? (i.amount || 0) + (i.additionalFee || 0)
              : 0),
          0,
        ),
        realizedRevenue: relevantInstallments.reduce(
          (sum, i) => sum + (i.paidAmount || 0),
          0,
        ),
      }),
    };
  }

  private mapPayableInstallment(
    inst: any,
    date: string,
    dateType: string,
    showValues: string,
  ) {
    const relevantInstallments = inst.payable.installments.filter((i) => {
      if (!i[dateType]) return false;
      const iDate = new Date(i[dateType]);
      iDate.setUTCHours(0, 0, 0, 0);
      return iDate.toISOString() === date;
    });

    return {
      type: 'payable',
      id: inst.payable.id,
      totalValue: inst.payable?.totalAmount || 0,
      totalPaid: (inst.payable?.installments || []).reduce(
        (sum, item) => sum + (item.paidAmount ?? 0),
        0,
      ),
      description: inst.payable.description || '',
      supplier: inst.payable.supplier
        ? {
            id: inst.payable.supplier.id,
            name: inst.payable.supplier.name,
          }
        : null,
      employee: inst.payable.employee
        ? {
            id: inst.payable.employee.id,
            name: inst.payable.employee.name,
          }
        : null,
      subCategory: inst.payable.subCategory
        ? {
            id: inst.payable.subCategory.id,
            name: inst.payable.subCategory.description,
          }
        : null,
      nature: inst.payable.nature
        ? {
            id: inst.payable.nature.id,
            name: inst.payable.nature.description,
          }
        : null,
      expenseSource: inst.payable.expenseSource || null,
      installmentsQuantity: inst.payable.installmentQty || 0,
      period: inst.payable?.referenceDate || null,
      notes: inst.payable.notes || '',
      status: inst.payable.status,
      currentInstallment: this.mapCurrentInstallment(inst.payable, inst.id),
      ...(showValues === 'on' && {
        expectedExpense: relevantInstallments.reduce(
          (sum, i) =>
            sum +
            (i.status !== 'CANCELED'
              ? (i.amount || 0) + (i.additionalFee || 0)
              : 0),
          0,
        ),
        realizedExpense: relevantInstallments.reduce(
          (sum, i) => sum + (i.paidAmount || 0),
          0,
        ),
      }),
    };
  }

  private mapCurrentInstallment(entity: any, installmentId: string) {
    const currentInst = entity?.installments?.find(
      (i) => i.id === installmentId,
    );
    if (!currentInst) return null;

    return {
      id: currentInst.id,
      installmentNumber: currentInst.installmentNumber || 1,
      status: this.getActualStatus(currentInst),
      paymentCondition: currentInst.paymentCondition
        ? {
            id: currentInst.paymentCondition.id,
            name: currentInst.paymentCondition.name,
          }
        : null,
      bankAccount: currentInst.bankAccount
        ? {
            id: currentInst.bankAccount.id,
            name: currentInst.bankAccount.name,
          }
        : null,
      bank: currentInst.bankAccount
        ? {
            id: currentInst.bankAccount?.bank?.id,
            name: currentInst.bankAccount?.bank?.name,
          }
        : null,
      value: currentInst.amount || 0,
      additionalFee: currentInst.additionalFee || 0,
      dueDate: currentInst.dueDate,
      paidValue: currentInst.paidAmount || 0,
      paymentDate: currentInst.provisionDate
        ? new Date(currentInst.provisionDate)
        : currentInst.paidDate
          ? new Date(currentInst.paidDate)
          : null,
      compensateDate: currentInst.paidDate
        ? new Date(currentInst.paidDate)
        : null,
      current: true,
    };
  }

  private async fetchDataDueDate(
    filtersReceivables,
    filtersPayables,
    showValues,
    sort,
  ) {
    const receivablesGrouped = await this.prisma.receivableInstallment.groupBy({
      by: ['dueDate'],
      where: filtersReceivables,
      orderBy: { dueDate: sort },
      _sum:
        showValues === 'on'
          ? { amount: true, additionalFee: true }
          : { additionalFee: true },
      _count: true,
    });

    const payablesGrouped = await this.prisma.payableInstallment.groupBy({
      by: ['dueDate'], // Adiciona o campo de agrupamento conforme o `dateType`
      where: filtersPayables,
      orderBy: { dueDate: sort },
      _sum:
        showValues === 'on'
          ? { amount: true, additionalFee: true }
          : { additionalFee: true },
      _count: true,
    });

    return [receivablesGrouped, payablesGrouped];
  }
  private async fetchDataPaidDate(
    filtersReceivables,
    filtersPayables,
    showValues,
    sort,
  ) {
    filtersReceivables = {
      ...filtersReceivables,
      paidDate: {
        not: null,
      },
    };
    filtersPayables = {
      ...filtersPayables,
      paidDate: {
        not: null,
      },
    };
    const receivablesGrouped = await this.prisma.receivableInstallment.groupBy({
      by: ['paidDate'],
      where: filtersReceivables,
      orderBy: { paidDate: sort },
      _sum:
        showValues === 'on' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    const payablesGrouped = await this.prisma.payableInstallment.groupBy({
      by: ['paidDate'], // Adiciona o campo de agrupamento conforme o `dateType`
      where: filtersPayables,
      orderBy: { paidDate: sort },
      _sum:
        showValues === 'on' ? { amount: true, additionalFee: true } : undefined,
      _count: true,
    });

    return [receivablesGrouped, payablesGrouped];
  }

  async getReceivableDetails(id: string) {
    const receivable = await this.prisma.receivable.findUnique({
      where: { id },
      include: {
        client: true,
        nature: true,
        subCategory: true,
        installments: {
          include: {
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    if (!receivable) {
      throw new NotFoundException('Conta a receber não encontrada.');
    }

    return receivable;
  }

  async getPayableDetails(id: string) {
    const payable = await this.prisma.payable.findUnique({
      where: { id },
      include: {
        supplier: true,
        employee: true,
        nature: true,
        subCategory: true,
        installments: {
          include: {
            paymentCondition: true,
            bankAccount: { include: { bank: true } },
          },
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    if (!payable) {
      throw new NotFoundException('Conta a pagar não encontrada.');
    }

    return payable;
  }

  async getOverdueAccountsLast7Days(companyId: string) {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const overdueReceivables = await this.prisma.receivableInstallment.findMany(
      {
        where: {
          receivable: {
            companyId: companyId,
            status: { not: 'CANCELED' },
          },
          dueDate: {
            gte: sevenDaysAgo,
            lt: todayEnd,
          },
          status: {
            notIn: ['PAID', 'CANCELED'],
          },
        },
        select: {
          dueDate: true,
        },
        orderBy: {
          dueDate: 'asc',
        },
      },
    );

    const overduePayables = await this.prisma.payableInstallment.findMany({
      where: {
        payable: {
          companyId: companyId,
          status: { not: 'CANCELED' },
        },
        dueDate: {
          gte: sevenDaysAgo,
          lt: todayEnd,
        },
        status: {
          notIn: ['PAID', 'CANCELED'],
        },
      },
      select: {
        dueDate: true,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    const allOverdueDates = [
      ...overdueReceivables.map((item) => item.dueDate),
      ...overduePayables.map((item) => item.dueDate),
    ].filter((date) => date && date < today);

    if (allOverdueDates.length === 0) {
      return {
        hasOverdue: false,
        oldestOverdueDate: null,
        count: 0,
      };
    }

    const oldestDate = allOverdueDates.reduce((oldest, current) =>
      current < oldest ? current : oldest,
    );

    return {
      hasOverdue: true,
      oldestOverdueDate: oldestDate,
      count: allOverdueDates.length,
    };
  }
}

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

const EXPORT_LIMIT = '10000';

@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  constructor(private readonly prisma: PrismaService) {}

  private getActualStatus(installment: InstallmentStatusCheck): string {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (
      installment.status === 'PENDING' &&
      new Date(installment.dueDate) < today
    ) {
      return 'OVERDUE';
    }
    return installment.status;
  }

  /**
   * Data que posiciona a parcela na linha do tempo do fluxo.
   * No modo "data de pagamento" a parcela provisionada ainda nao tem
   * paidDate (ele so e gravado na compensacao) e a tela exibe o
   * provisionDate como data de pagamento - entao e ele que vale aqui.
   */
  private getFlowDate(installment: any, dateType: string): Date | null {
    const raw =
      dateType === 'paidDate'
        ? (installment.provisionDate ?? installment.paidDate)
        : installment.dueDate;
    return raw ? new Date(raw) : null;
  }

  private getFlowDateKey(installment: any, dateType: string): string | null {
    const date = this.getFlowDate(installment, dateType);
    if (!date) return null;
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString();
  }

  /**
   * Monta o where de recebiveis e pagaveis. Usado pela listagem e pelos
   * totais, para que os dois nunca divirjam.
   */
  private buildFlowFilters(filter: FinancialFlowFilterDTO) {
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
      receivable: { companyId: filter.companyId },
    };
    const filtersPayables: any = {
      payable: { companyId: filter.companyId },
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

    let dateRange: any = null;
    if (startDate || endDate) {
      dateRange = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        dateRange.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateRange.lte = end;
      }
    }

    const andReceivables: any[] = [];
    const andPayables: any[] = [];

    if (dateType === 'paidDate') {
      // Data efetiva de pagamento: provisionDate quando existir, senao
      // paidDate. Sem isso a parcela provisionada (paidDate nulo) sumia da
      // visao por data de pagamento, e a compensada era agrupada pela data
      // da compensacao em vez da data exibida na linha.
      const paidWindow = dateRange
        ? [
            { provisionDate: dateRange },
            { provisionDate: null, paidDate: dateRange },
          ]
        : [{ provisionDate: { not: null } }, { paidDate: { not: null } }];

      andReceivables.push({ OR: paidWindow });
      andPayables.push({ OR: paidWindow });
    } else if (dateRange) {
      filtersReceivables.dueDate = dateRange;
      filtersPayables.dueDate = dateRange;
    }

    // Filtro de status
    if (status) {
      if (status === 'OVERDUE') {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        filtersReceivables.status = 'PENDING';
        filtersReceivables.dueDate = {
          ...filtersReceivables.dueDate,
          lt: today,
        };

        filtersPayables.status = 'PENDING';
        filtersPayables.dueDate = {
          ...filtersPayables.dueDate,
          lt: today,
        };
      } else {
        filtersReceivables.status = status;
        filtersPayables.status = status;
      }
    }

    // Filtro de condicao de pagamento
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
      andReceivables.push({
        OR: [
          {
            receivable: {
              client: { name: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            receivable: {
              description: { contains: search, mode: 'insensitive' },
            },
          },
          {
            receivable: {
              reference: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      });
      andPayables.push({
        OR: [
          {
            payable: {
              supplier: { name: { contains: search, mode: 'insensitive' } },
            },
          },
          {
            payable: {
              description: { contains: search, mode: 'insensitive' },
            },
          },
          {
            payable: {
              reference: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (andReceivables.length) filtersReceivables.AND = andReceivables;
    if (andPayables.length) filtersPayables.AND = andPayables;

    // Só um lado: o outro não traz nenhuma parcela
    if (filter.type === 'receivable') filtersPayables.id = { in: [] };
    if (filter.type === 'payable') filtersReceivables.id = { in: [] };

    return { filtersReceivables, filtersPayables };
  }

  /**
   * open (a receber / a pagar) e somado parcela a parcela e so conta parcela
   * ainda em aberto. Antes a tela fazia expected - totalPaid sobre o conjunto
   * inteiro, entao toda parcela quitada por valor diferente do previsto
   * (pagamento com diferenca, juros lancado depois) deixava um residuo
   * permanente em "A receber" - inclusive na visao por data de pagamento,
   * onde tudo ja esta quitado e o valor tinha de ser zero.
   */
  private sumInstallmentTotals(installments: any[]) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    return installments.reduce(
      (acc, inst) => {
        const isCanceled = inst.status === 'CANCELED';
        const expected = isCanceled
          ? 0
          : (inst.amount ?? 0) + (inst.additionalFee ?? 0);
        const totalPaid = inst.paidAmount ?? 0;
        const isSettled =
          isCanceled || inst.status === 'PAID' || inst.status === 'PROVISIONED';
        const open = isSettled ? 0 : Math.max(0, expected - totalPaid);
        // Vencido e o proprio `open` que ja passou da data. Fica sempre
        // contido no "a realizar", em vez de vir de outra consulta.
        const isOverdue =
          open > 0 && !!inst.dueDate && new Date(inst.dueDate) < today;

        return {
          expected: acc.expected + expected,
          totalPaid: acc.totalPaid + totalPaid,
          open: acc.open + open,
          paidCount: acc.paidCount + (totalPaid > 0 ? 1 : 0),
          overdue: acc.overdue + (isOverdue ? open : 0),
          overdueCount: acc.overdueCount + (isOverdue ? 1 : 0),
        };
      },
      {
        expected: 0,
        totalPaid: 0,
        open: 0,
        paidCount: 0,
        overdue: 0,
        overdueCount: 0,
      },
    );
  }

  async findAllTotals(filter: FinancialFlowFilterDTO) {
    const { dateType = 'dueDate' } = filter;

    if (!['dueDate', 'paidDate'].includes(dateType)) {
      throw new BadRequestException(
        'Invalid dateType. Use "dueDate" or "paidDate".',
      );
    }

    const { filtersReceivables, filtersPayables } =
      this.buildFlowFilters(filter);

    const [receivableDetails, payableDetails] = await Promise.all([
      this.prisma.receivableInstallment.findMany({ where: filtersReceivables }),
      this.prisma.payableInstallment.findMany({ where: filtersPayables }),
    ]);

    return {
      receivables: this.sumInstallmentTotals(receivableDetails),
      payables: this.sumInstallmentTotals(payableDetails),
    };
  }

  async findAll(paginationDto: FinancialFlowFilterDTO) {
    const {
      page = 1,
      limit = 10,
      sort = 'desc',
      dateType = 'dueDate',
      showValues = 'on',
    } = paginationDto;

    if (!['dueDate', 'paidDate'].includes(dateType)) {
      throw new BadRequestException(
        'Invalid dateType. Use "dueDate" or "paidDate".',
      );
    }

    const { filtersReceivables, filtersPayables } =
      this.buildFlowFilters(paginationDto);

    try {
      const [receivableDetails, payableDetails] = await Promise.all([
        this.prisma.receivableInstallment.findMany({
          where: filtersReceivables,
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
                quotation: {
                  select: { quotationPayment: { select: { type: true } } },
                },
              },
            },
          },
        }),
        this.prisma.payableInstallment.findMany({
          where: filtersPayables,
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
        }),
      ]);

      // As datas dos grupos saem das proprias parcelas retornadas. Antes
      // havia um groupBy seguido de uma segunda consulta com
      // IN (datas zeradas na meia-noite), que perdia toda parcela gravada
      // com hora: ela contava no card e nao tinha linha na lista.
      const dueDates = [
        ...new Set([
          ...receivableDetails.map((inst) =>
            this.getFlowDateKey(inst, dateType),
          ),
          ...payableDetails.map((inst) => this.getFlowDateKey(inst, dateType)),
        ]),
      ]
        .filter((d): d is string => d !== null)
        .sort((a, b) =>
          sort.toLowerCase() === 'asc'
            ? a.localeCompare(b)
            : b.localeCompare(a),
        );

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
      this.logger.error(
        'Erro ao buscar dados do fluxo financeiro',
        error.stack,
      );
      throw new InternalServerErrorException(
        'Error fetching financial flow data',
      );
    }
  }

  async findAllForExport(filter: FinancialFlowFilterDTO) {
    const result = await this.findAll({
      ...filter,
      page: '1',
      limit: EXPORT_LIMIT,
      showValues: filter.showValues || 'on',
    });

    const data = result.data.flatMap((group) =>
      group.transactions.map((transaction) => ({
        ...transaction,
        groupDate: group.date,
      })),
    );

    return {
      total: data.length,
      totalGroups: result.total,
      exportLimit: Number(EXPORT_LIMIT),
      data,
    };
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
        .filter((inst) => this.getFlowDateKey(inst, dateType) === date)
        .map((inst) =>
          this.mapReceivableInstallment(inst, date, dateType, showValues),
        );

      const payables = payableDetails
        .filter((inst) => this.getFlowDateKey(inst, dateType) === date)
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
    const relevantInstallments = inst.receivable.installments.filter(
      (i) => this.getFlowDateKey(i, dateType) === date,
    );

    return {
      type: 'receivable',
      id: inst.receivable.id,
      totalValue: inst.receivable?.totalAmount || 0,
      totalPaid: (inst.receivable?.installments || []).reduce(
        (sum, item) => sum + (item.paidAmount ?? 0),
        0,
      ),
      description: inst.receivable.description || '',
      invoiceType: inst.receivable.quotation?.quotationPayment?.type ?? null,
      client: inst.receivable.client
        ? {
            id: inst.receivable.client.id,
            name: inst.receivable.client.name,
            cnpj: inst.receivable.client.cnpj,
            cpf: inst.receivable.client.cpf,
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
    const relevantInstallments = inst.payable.installments.filter(
      (i) => this.getFlowDateKey(i, dateType) === date,
    );

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
        quotation: {
          select: { quotationPayment: { select: { type: true } } },
        },
      },
    });

    if (!receivable) {
      throw new NotFoundException('Conta a receber não encontrada.');
    }

    return {
      ...receivable,
      invoiceType: receivable.quotation?.quotationPayment?.type ?? null,
    };
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

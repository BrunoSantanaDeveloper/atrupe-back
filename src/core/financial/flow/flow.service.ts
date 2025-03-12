import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { FinancialFlowFilterDTO } from './dto/filter.dto';

@Injectable()
export class FlowService {
  constructor(private readonly prisma: PrismaService) {}
  async findAllTotals(filter: FinancialFlowFilterDTO) {
    const {
      search,
      startDate,
      endDate,
      status,
      paymentMethodId,
      bankAccountId,
      dateType = 'dueDate',
    } = filter;

    const filtersReceivables: any = {
      receivable: {
        companyId: filter.companyId,
      },
    };
    const filtersPayables: any = {
      payable: {
        companyId: filter.companyId,
      },
    };

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      filtersReceivables[dateType] = dateFilter;
      filtersPayables[dateType] = dateFilter;
    }

    // Filtro de status
    if (status) {
      filtersReceivables.status = status;
      filtersPayables.status = status;
    }

    // Filtro de método de pagamento
    if (paymentMethodId) {
      filtersReceivables.paymentMethodId = paymentMethodId;
      filtersPayables.paymentMethodId = paymentMethodId;
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
        const expected = inst.status !== 'CANCELED' ? inst.amount ?? 0 : 0;
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
        const expected = inst.status !== 'CANCELED' ? inst.amount ?? 0 : 0;
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
      paymentMethodId,
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
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);

      filtersReceivables[dateType] = dateFilter;
      filtersPayables[dateType] = dateFilter;
    }

    // Filtro de status
    if (status) {
      filtersReceivables.status = status;
      filtersPayables.status = status;
    }

    // Filtro de método de pagamento
    if (paymentMethodId) {
      filtersReceivables.paymentMethodId = paymentMethodId;
      filtersPayables.paymentMethodId = paymentMethodId;
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
      const dueDates = [
        ...new Set([
          ...receivablesGrouped.map((g) => g[dateType]?.toISOString()),
          ...payablesGrouped.map((g) => g[dateType]?.toISOString()),
        ]),
      ];

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
                    paymentMethod: true,
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
              nature: true,
              subCategory: true,
              installments: {
                include: {
                  paymentMethod: true,
                  bankAccount: { include: { bank: true } },
                },
                orderBy: { [dateType]: 'desc' },
              },
            },
          },
        },
      });

      const groupedData = dueDates.map((date) => {
        const receivables = receivableDetails
          .filter((inst) => inst[dateType]?.toISOString() === date)
          .map((inst) => {
            // Filtrar apenas as parcelas com a mesma data do grupo
            const relevantInstallments = inst.receivable.installments.filter(
              (i) => i[dateType]?.toISOString() === date,
            );

            return {
              type: 'receivable',
              id: inst.receivable.id,
              totalValue: inst.receivable?.totalAmount || 0,
              totalPaid: (inst.receivable?.installments || []).reduce(
                (sum, item) => {
                  return sum + (item.paidAmount ?? 0);
                },
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
              isSale: inst.receivable.quotationId ? true : false,

              installments: (inst.receivable?.installments || [])
                .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
                .map((i) => ({
                  id: i.id,
                  status: i.status,
                  paymentMethod: i.paymentMethod
                    ? {
                        id: i.paymentMethod.id,
                        name: i.paymentMethod.name,
                      }
                    : null,
                  bankAccount: i.bankAccount
                    ? {
                        id: i.bankAccount.id,
                        name: i.bankAccount.name,
                      }
                    : null,
                  bank: i.bankAccount
                    ? {
                        id: i.bankAccount?.bank?.id,
                        name: i.bankAccount?.bank?.name,
                      }
                    : null,
                  value: i.amount || 0,
                  additionalFee: i.additionalFee || 0,
                  dueDate: i.dueDate,
                  paidValue: i.paidAmount || 0,
                  paymentDate: i.provisionDate
                    ? new Date(i.provisionDate)
                    : i.paidDate
                      ? new Date(i.paidDate)
                      : null,
                  compensateDate: i.paidDate ? new Date(i.paidDate) : null,
                  current: inst.id === i.id,
                })),
              ...(showValues === 'on' && {
                expectedRevenue: relevantInstallments.reduce(
                  (sum, i) => sum + (i.amount || 0) + (i.additionalFee || 0),
                  0,
                ),
                realizedRevenue: relevantInstallments.reduce(
                  (sum, i) => sum + (i.paidAmount || 0),
                  0,
                ),
              }),
            };
          });

        const payables = payableDetails
          .filter((inst) => inst[dateType]?.toISOString() === date)
          .map((inst) => {
            // Filtrar apenas as parcelas com a mesma data do grupo
            const relevantInstallments = inst.payable.installments.filter(
              (i) => i[dateType]?.toISOString() === date,
            );

            return {
              type: 'payable',
              id: inst.payable.id,
              totalValue: inst.payable?.totalAmount || 0,
              totalPaid: (inst.payable?.installments || []).reduce(
                (sum, item) => {
                  return sum + (item.paidAmount ?? 0);
                },
                0,
              ),
              description: inst.payable.description || '',
              supplier: inst.payable.supplier
                ? {
                    id: inst.payable.supplier.id,
                    name: inst.payable.supplier.name,
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
              installmentsQuantity: inst.payable.installmentQty || 0,
              period: inst.payable?.referenceDate || null,
              notes: inst.payable.notes || '',
              status: inst.payable.status,
              isSale: inst.payable.quotationId ? true : false,

              installments: (inst.payable?.installments || [])
                .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
                .map((i) => ({
                  id: i.id,
                  status: i.status,
                  paymentMethod: i.paymentMethod
                    ? {
                        id: i.paymentMethod.id,
                        name: i.paymentMethod.name,
                      }
                    : null,
                  bankAccount: i.bankAccount
                    ? {
                        id: i.bankAccount.id,
                        name: i.bankAccount.name,
                      }
                    : null,
                  bank: i.bankAccount
                    ? {
                        id: i.bankAccount?.bank?.id,
                        name: i.bankAccount?.bank?.name,
                      }
                    : null,
                  value: i.amount || 0,
                  additionalFee: i.additionalFee || 0,
                  dueDate: i.dueDate,
                  paidValue: i.paidAmount || 0,
                  paymentDate: i.provisionDate
                    ? new Date(i.provisionDate)
                    : i.paidDate
                      ? new Date(i.paidDate)
                      : null,
                  compensateDate: i.paidDate ? new Date(i.paidDate) : null,
                  current: inst.id === i.id,
                })),
              ...(showValues === 'on' && {
                expectedExpense: relevantInstallments.reduce(
                  (sum, i) => sum + (i.amount || 0) + (i.additionalFee || 0),
                  0,
                ),
                realizedExpense: relevantInstallments.reduce(
                  (sum, i) => sum + (i.paidAmount || 0),
                  0,
                ),
              }),
            };
          });

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

      const total = groupedData.length;
      const lastPage = Math.ceil(total / +limit);

      return {
        total,
        lastPage,
        data: groupedData.slice((+page - 1) * +limit, +page * +limit),
      };
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Error fetching financial flow data',
      );
    }
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
}

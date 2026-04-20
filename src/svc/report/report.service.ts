import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ReportMenuDto } from './dto/menu.dto';
import {
  SalesReportFilterDto,
  SalesReportSummaryResponse,
  SalesEvolutionDataPoint,
  SalesEvolutionResponse,
  ApprovedRejectedDataPoint,
  OriginChartDataPoint,
  TopProductItem,
  TopClientItem,
  SalesTableDataResponse,
  SaleRecordItem,
  SalesClientGroup,
  SalesSellerGroup,
  SalePhase,
} from './dto/sales-report.dto';
import {
  FinancialReportFilterDto,
  AdvancedFinancialReportFilterDto,
} from './dto/financial-report.dto';
import { CashFlowReportFilterDto } from './dto/cash-flow-report.dto';
import { DfcReportFilterDto } from './dto/dfc-report.dto';
import { CommissionReportFilterDto } from './dto/commission-report.dto';
import { QuotationService } from '../../core/sale/quotation/quotation.service';
import { OrderService } from '../../core/sale/order/order.service';
import { PayableService } from '../../core/financial/payable/payable.service';
import { ReceivableService } from '../../core/financial/receivable/receivable.service';
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  addMonths,
  format,
  differenceInHours,
  differenceInCalendarMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Origin colors for chart - known origins get fixed colors
const ORIGIN_COLORS: Record<string, string> = {
  WhatsApp: '#039855',
  Balcão: '#F97066',
  Instagram: '#475467',
  Site: '#F79009',
  'E-mail': '#6172F3',
  'Venda Direta': '#EE46BC',
  Indicação: '#15B79E',
  Telefone: '#7A5AF8',
  Facebook: '#1877F2',
  LinkedIn: '#0A66C2',
  Outros: '#FDB022',
};

// Fallback palette for origins not in the map above
const FALLBACK_COLORS = [
  '#F97066',
  '#6172F3',
  '#EE46BC',
  '#15B79E',
  '#7A5AF8',
  '#F79009',
  '#0EA5E9',
  '#84CC16',
  '#D946EF',
  '#F43F5E',
  '#14B8A6',
  '#A855F7',
];

function getOriginColor(name: string, index: number): string {
  return ORIGIN_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotationService: QuotationService,
    private readonly orderService: OrderService,
    private readonly payableService: PayableService,
    private readonly receivableService: ReceivableService,
  ) {}

  async menu(companyId: string): Promise<ReportMenuDto> {
    const quotations = await this.quotationService.count(companyId);
    const orders = await this.orderService.count(companyId);
    const payable = await this.payableService.count(companyId);
    const receivable = await this.receivableService.count(companyId);
    return {
      sales: { quotations, orders },
      financial: { receivable, payable },
      production: { followUp: 0, production: 0 },
    };
  }

  // ============== SALES REPORT METHODS ==============

  private getDateRange(filters: SalesReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(subMonths(now, 5));
    const endDate = filters.endDate
      ? new Date(filters.endDate)
      : endOfMonth(now);
    return { startDate, endDate };
  }

  /**
   * Calcula o valor composto de um orçamento, incluindo entrega, comissão e taxas.
   * Fórmula igual ao frontend (QuotationsData.tsx).
   */
  private computeQuotationCompositeValue(q: {
    totalValue: number;
    deliveryInfo?: { value: number | null } | null;
    quotationPayment?: {
      discountTotal?: number | null;
      downPaymentAdditionalFee?: number | null;
      commission?: {
        type: string | null;
        totalCommission: number | null;
      } | null;
      quotationInstallment?: { additionalFee: number | null }[];
    } | null;
  }): number {
    const itemsValue = q.totalValue || 0;
    const deliveryValue = q.deliveryInfo?.value ?? 0;
    const payment = q.quotationPayment;
    const commissionValue =
      payment?.commission?.type === 'ADD'
        ? (payment?.commission?.totalCommission ?? 0)
        : 0;
    const installmentsAdditionalFee =
      payment?.quotationInstallment?.reduce(
        (acc, inst) => acc + (inst?.additionalFee ?? 0),
        0,
      ) ?? 0;
    const downPaymentAdditionalFee = payment?.downPaymentAdditionalFee ?? 0;
    const totalAdditionalFee =
      installmentsAdditionalFee + downPaymentAdditionalFee;
    const discountTotal = payment?.discountTotal ?? 0;

    return (
      itemsValue +
      deliveryValue +
      commissionValue +
      totalAdditionalFee -
      discountTotal
    );
  }

  private readonly quotationValueSelect = {
    totalValue: true,
    deliveryInfo: { select: { value: true } },
    quotationPayment: {
      select: {
        discountTotal: true,
        downPaymentAdditionalFee: true,
        commission: {
          select: { type: true, totalCommission: true },
        },
        quotationInstallment: {
          select: { additionalFee: true },
        },
      },
    },
  };

  async getSalesReportSummary(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<SalesReportSummaryResponse> {
    const { startDate, endDate } = this.getDateRange(filters);

    // Approved orders (approved quotations, excluding canceled)
    const approvedOrders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELED' },
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: {
            ...this.quotationValueSelect,
            approvedAt: true,
            createdAt: true,
            seller: {
              select: {
                sellerProfile: {
                  select: { commission: true },
                },
              },
            },
          },
        },
      },
    });

    const approvedTotal = approvedOrders.reduce(
      (sum, o) => sum + this.computeQuotationCompositeValue(o.quotation),
      0,
    );
    const approvedCount = approvedOrders.length;

    // Commission total (seller profile percentage * compositeValue)
    const commission = approvedOrders.reduce((sum, o) => {
      const sellerCommission =
        o.quotation.seller?.sellerProfile?.commission || 0;
      const value = this.computeQuotationCompositeValue(o.quotation);
      return sum + (value * sellerCommission) / 100;
    }, 0);

    // Average approval time
    let totalHours = 0;
    let countWithApproval = 0;
    approvedOrders.forEach((o) => {
      if (o.quotation.approvedAt) {
        totalHours += differenceInHours(
          o.quotation.approvedAt,
          o.quotation.createdAt,
        );
        countWithApproval++;
      }
    });
    const avgHours =
      countWithApproval > 0 ? Math.round(totalHours / countWithApproval) : 0;
    const approvalTime = `${Math.floor(avgHours / 24)}d ${avgHours % 24}h`;

    // Rejected quotations
    const rejectedQuotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        status: 'REJECTED',
        updatedAt: { gte: startDate, lte: endDate },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
      select: this.quotationValueSelect,
    });

    const rejectedTotal = rejectedQuotations.reduce(
      (sum, q) => sum + this.computeQuotationCompositeValue(q),
      0,
    );
    const rejectedCount = rejectedQuotations.length;

    // Awaiting response (DONE quotations created in the period, still within due date)
    const now = new Date();
    const awaitingQuotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        status: 'DONE',
        approvedAt: null,
        createdAt: { gte: startDate, lte: endDate },
        OR: [{ dueDate: null }, { dueDate: { gte: now } }],
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
      select: this.quotationValueSelect,
    });

    const noResponseTotal = awaitingQuotations.reduce(
      (sum, q) => sum + this.computeQuotationCompositeValue(q),
      0,
    );
    const noResponseCount = awaitingQuotations.length;

    // Expired quotations (DONE, dueDate already passed, filtered by dueDate in period)
    const expiredQuotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        status: 'DONE',
        approvedAt: null,
        dueDate: { lt: now, gte: startDate, lte: endDate },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
      select: this.quotationValueSelect,
    });

    const expiredTotal = expiredQuotations.reduce(
      (sum, q) => sum + this.computeQuotationCompositeValue(q),
      0,
    );
    const expiredCount = expiredQuotations.length;

    // Canceled orders
    const canceledOrders = await this.prisma.order.findMany({
      where: {
        status: 'CANCELED',
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: this.quotationValueSelect,
        },
      },
    });

    const canceledTotal = canceledOrders.reduce(
      (sum, o) => sum + this.computeQuotationCompositeValue(o.quotation),
      0,
    );
    const canceledCount = canceledOrders.length;

    // Average ticket
    const averageTicket = approvedCount > 0 ? approvedTotal / approvedCount : 0;

    return {
      approvedTotal,
      approvedCount,
      rejectedTotal,
      rejectedCount,
      noResponseTotal,
      noResponseCount,
      expiredTotal,
      expiredCount,
      canceledTotal,
      canceledCount,
      averageTicket,
      commission,
      approvalTime,
    };
  }

  async getSalesEvolution(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<SalesEvolutionResponse> {
    const { startDate, endDate } = this.getDateRange(filters);
    const monthsDiff = differenceInCalendarMonths(endDate, startDate);

    // Determine mode
    if (monthsDiff <= 1) {
      return this.getSalesEvolutionDaily(
        companyId,
        filters,
        startDate,
        endDate,
      );
    } else if (monthsDiff <= 12) {
      return this.getSalesEvolutionMonthly(
        companyId,
        filters,
        startDate,
        endDate,
      );
    } else {
      return this.getSalesEvolutionYearly(
        companyId,
        filters,
        startDate,
        endDate,
      );
    }
  }

  private async getSalesEvolutionDaily(
    companyId: string,
    filters: SalesReportFilterDto,
    startDate: Date,
    endDate: Date,
  ): Promise<SalesEvolutionResponse> {
    const orders = await this.fetchEvolutionOrders(
      companyId,
      filters,
      startDate,
      endDate,
    );

    const dailyData: Record<
      string,
      { sortKey: string; approved: number; count: number }
    > = {};

    orders.forEach((order) => {
      if (order.quotation.approvedAt) {
        const day = format(order.quotation.approvedAt, 'd/MMM', {
          locale: ptBR,
        });
        const sortKey = format(order.quotation.approvedAt, 'yyyy-MM-dd');
        if (!dailyData[day]) {
          dailyData[day] = { sortKey, approved: 0, count: 0 };
        }
        dailyData[day].approved += this.computeQuotationCompositeValue(
          order.quotation,
        );
        dailyData[day].count += 1;
      }
    });

    const data: SalesEvolutionDataPoint[] = Object.entries(dailyData)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .filter(([_, d]) => d.approved > 0)
      .sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey))
      .map(([day, d]) => ({ day, approved: d.approved, count: d.count }));

    return { mode: 'daily', data, yearlyData: [] };
  }

  private async getSalesEvolutionMonthly(
    companyId: string,
    filters: SalesReportFilterDto,
    startDate: Date,
    endDate: Date,
  ): Promise<SalesEvolutionResponse> {
    // Expand to full months
    const adjustedStart = startOfMonth(startDate);
    const adjustedEnd = endOfMonth(endDate);

    const orders = await this.fetchEvolutionOrders(
      companyId,
      filters,
      adjustedStart,
      adjustedEnd,
    );

    // Pre-populate all months in range
    const monthlyData: Record<
      string,
      { sortKey: string; approved: number; count: number }
    > = {};
    let cursor = adjustedStart;
    while (cursor <= adjustedEnd) {
      const label = format(cursor, 'MMM/yy', { locale: ptBR });
      const sortKey = format(cursor, 'yyyy-MM');
      monthlyData[label] = { sortKey, approved: 0, count: 0 };
      cursor = addMonths(cursor, 1);
    }

    orders.forEach((order) => {
      if (order.quotation.approvedAt) {
        const label = format(order.quotation.approvedAt, 'MMM/yy', {
          locale: ptBR,
        });
        if (monthlyData[label]) {
          monthlyData[label].approved += this.computeQuotationCompositeValue(
            order.quotation,
          );
          monthlyData[label].count += 1;
        }
      }
    });

    const data: SalesEvolutionDataPoint[] = Object.entries(monthlyData)
      .sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey))
      .map(([day, d]) => ({ day, approved: d.approved, count: d.count }));

    return { mode: 'monthly', data, yearlyData: [] };
  }

  private async getSalesEvolutionYearly(
    companyId: string,
    filters: SalesReportFilterDto,
    startDate: Date,
    endDate: Date,
  ): Promise<SalesEvolutionResponse> {
    // Expand each year to full months (rule 2)
    const adjustedStart = startOfMonth(startDate);
    const adjustedEnd = endOfMonth(endDate);

    const orders = await this.fetchEvolutionOrders(
      companyId,
      filters,
      adjustedStart,
      adjustedEnd,
    );

    const startYear = adjustedStart.getFullYear();
    const endYear = adjustedEnd.getFullYear();

    // Month labels (Jan-Dec)
    const monthLabels = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2024, i, 1);
      return format(d, 'MMM', { locale: ptBR }).replace(/^./, (c) =>
        c.toUpperCase(),
      );
    });

    // Build per-year data
    const yearlyData = [];
    for (let year = startYear; year <= endYear; year++) {
      const yearStartMonth = year === startYear ? adjustedStart.getMonth() : 0;
      const yearEndMonth = year === endYear ? adjustedEnd.getMonth() : 11;

      const months = monthLabels
        .map((label, monthIdx) => {
          if (monthIdx < yearStartMonth || monthIdx > yearEndMonth) {
            return null;
          }
          return { month: label, approved: 0, count: 0 };
        })
        .filter(Boolean) as {
        month: string;
        approved: number;
        count: number;
      }[];

      yearlyData.push({ year, data: months });
    }

    // Aggregate orders into yearly buckets
    orders.forEach((order) => {
      if (order.quotation.approvedAt) {
        const year = order.quotation.approvedAt.getFullYear();
        const monthIdx = order.quotation.approvedAt.getMonth();
        const monthLabel = monthLabels[monthIdx];

        const yearEntry = yearlyData.find((y) => y.year === year);
        if (yearEntry) {
          const monthEntry = yearEntry.data.find((m) => m.month === monthLabel);
          if (monthEntry) {
            monthEntry.approved += this.computeQuotationCompositeValue(
              order.quotation,
            );
            monthEntry.count += 1;
          }
        }
      }
    });

    return { mode: 'yearly', data: [], yearlyData };
  }

  private async fetchEvolutionOrders(
    companyId: string,
    filters: SalesReportFilterDto,
    startDate: Date,
    endDate: Date,
  ) {
    return this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELED' },
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: {
            ...this.quotationValueSelect,
            approvedAt: true,
          },
        },
      },
    });
  }

  async getApprovedRejected(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<ApprovedRejectedDataPoint[]> {
    // Always show current month + last 5 months (6 months total)
    const now = new Date();
    const sixMonthsAgo = startOfMonth(subMonths(now, 5));
    const currentMonthEnd = endOfMonth(now);

    const quotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        createdAt: { gte: sixMonthsAgo, lte: currentMonthEnd },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
      include: {
        order: { select: { id: true, status: true } },
      },
    });

    // Get filter period for due date/rejection checks
    const { startDate: filterStart, endDate: filterEnd } =
      this.getDateRange(filters);

    // Pre-populate all 6 months to ensure they all appear
    const monthlyData: Record<
      string,
      {
        monthIndex: number;
        approved: number;
        canceled: number;
        expired: number;
        rejected: number;
      }
    > = {};

    for (let i = 5; i >= 0; i--) {
      const date = subMonths(now, i);
      const monthKey = format(date, 'MMM', { locale: ptBR });
      const monthIndex = 5 - i;
      monthlyData[monthKey] = {
        monthIndex,
        approved: 0,
        canceled: 0,
        expired: 0,
        rejected: 0,
      };
    }

    quotations.forEach((q) => {
      const month = format(q.createdAt, 'MMM', { locale: ptBR });
      if (!monthlyData[month]) return;

      if (q.order) {
        if (q.order.status === 'CANCELED') {
          monthlyData[month].canceled++;
        } else {
          monthlyData[month].approved++;
        }
      } else if (q.status === 'REJECTED') {
        // Check if rejection is within filter period
        if (
          q.updatedAt &&
          q.updatedAt >= filterStart &&
          q.updatedAt <= filterEnd
        ) {
          monthlyData[month].rejected++;
        }
      } else if (q.dueDate && q.dueDate < new Date() && !q.approvedAt) {
        // Check if due date is within filter period
        if (q.dueDate >= filterStart && q.dueDate <= filterEnd) {
          monthlyData[month].expired++;
        }
      }
    });

    return Object.entries(monthlyData)
      .sort(([, a], [, b]) => a.monthIndex - b.monthIndex)
      .map(([label, data]) => ({
        label: label.charAt(0).toUpperCase() + label.slice(1),
        approved: data.approved,
        canceled: data.canceled,
        expired: data.expired,
        rejected: data.rejected,
      }));
  }

  async getQuotationsOrigin(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<OriginChartDataPoint[]> {
    const { startDate, endDate } = this.getDateRange(filters);

    const quotationsWithOrigin = await this.prisma.quotation.groupBy({
      by: ['contactSourceId'],
      where: {
        companyId,
        createdAt: { gte: startDate, lte: endDate },
        contactSourceId: { not: null },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
      _count: true,
    });

    // Fetch origin names
    const originIds = quotationsWithOrigin
      .map((q) => q.contactSourceId)
      .filter(Boolean) as string[];
    const origins = await this.prisma.contactSource.findMany({
      where: { id: { in: originIds } },
    });

    const originMap = new Map(origins.map((o) => [o.id, o.name]));

    return quotationsWithOrigin.map((q, index) => {
      const name = originMap.get(q.contactSourceId!) || 'Outros';
      return {
        name,
        value: q._count,
        color: getOriginColor(name, index),
      };
    });
  }

  async getOrdersOrigin(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<OriginChartDataPoint[]> {
    const { startDate, endDate } = this.getDateRange(filters);

    const ordersWithOrigin = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELED' },
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          contactSourceId: { not: null },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: { contactSourceId: true },
        },
      },
    });

    // Group by origin
    const originCounts: Record<string, number> = {};
    ordersWithOrigin.forEach((o) => {
      const sourceId = o.quotation.contactSourceId;
      if (sourceId) {
        originCounts[sourceId] = (originCounts[sourceId] || 0) + 1;
      }
    });

    // Fetch origin names
    const originIds = Object.keys(originCounts);
    const origins = await this.prisma.contactSource.findMany({
      where: { id: { in: originIds } },
    });

    const originMap = new Map(origins.map((o) => [o.id, o.name]));

    return originIds.map((id, index) => {
      const name = originMap.get(id) || 'Outros';
      return {
        name,
        value: originCounts[id],
        color: getOriginColor(name, index),
      };
    });
  }

  async getTopProducts(
    companyId: string,
    filters: SalesReportFilterDto,
    limit = 10,
  ): Promise<TopProductItem[]> {
    const { startDate, endDate } = this.getDateRange(filters);

    const orderProducts = await this.prisma.quotationProduct.findMany({
      where: {
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          order: { status: { not: 'CANCELED' } },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        product: { select: { id: true, name: true } },
      },
    });

    // Aggregate by product
    const productTotals: Record<string, { name: string; value: number }> = {};

    orderProducts.forEach((qp) => {
      const productId = qp.productId;
      if (!productTotals[productId]) {
        productTotals[productId] = {
          name: qp.product?.name || 'Produto',
          value: 0,
        };
      }
      productTotals[productId].value += qp.finalValue || 0;
    });

    return Object.values(productTotals)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((p) => ({ ...p, type: 'Produto' }));
  }

  async getTopClients(
    companyId: string,
    filters: SalesReportFilterDto,
    limit = 10,
  ): Promise<TopClientItem[]> {
    const { startDate, endDate } = this.getDateRange(filters);

    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELED' },
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          clientId: { not: null },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: {
            clientId: true,
            totalValue: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    // Aggregate by client
    const clientTotals: Record<string, { name: string; value: number }> = {};

    orders.forEach((o) => {
      const clientId = o.quotation.clientId;
      if (clientId) {
        if (!clientTotals[clientId]) {
          clientTotals[clientId] = {
            name: o.quotation.client?.name || 'Cliente',
            value: 0,
          };
        }
        clientTotals[clientId].value += o.quotation.totalValue || 0;
      }
    });

    return Object.values(clientTotals)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  }

  async getSalesTableData(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<SalesTableDataResponse & { pagination: any }> {
    const { startDate, endDate } = this.getDateRange(filters);
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const groupBy = filters.groupBy || 'client';
    const orderBy = filters.orderBy || 'approvedDate';

    // Base where clause — include canceled orders
    const whereClause = {
      quotation: {
        companyId,
        approvedAt: { gte: startDate, lte: endDate },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
    };

    // Get total count
    const totalCount = await this.prisma.order.count({ where: whereClause });

    // Determine order
    let orderByClause: any = { quotation: { approvedAt: 'desc' } };
    if (orderBy === 'valueDesc') {
      orderByClause = { quotation: { totalValue: 'desc' } };
    } else if (orderBy === 'valueAsc') {
      orderByClause = { quotation: { totalValue: 'asc' } };
    }

    // When grouped, we need ALL records to build complete groups,
    // then paginate at the group level.
    // When ungrouped, paginate at the record level.
    const isGrouped = groupBy === 'client' || groupBy === 'seller';

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      include: {
        quotation: {
          include: {
            client: { select: { id: true, name: true } },
            seller: { select: { id: true, name: true } },
            series: { select: { code: true } },
          },
        },
      },
      orderBy: orderByClause,
      // Only paginate at query level when NOT grouped
      ...(!isGrouped && { take: limit, skip: (page - 1) * limit }),
    });

    // Map to SaleRecordItem
    const mapToRecord = (order: any): SaleRecordItem => {
      const q = order.quotation;
      const phase: SalePhase =
        order.status === 'CANCELED'
          ? 'cancelada'
          : order.status === 'FINISHED'
            ? 'entregue'
            : order.status === 'IN_PRODUCTION' ||
                order.status === 'COMPLETED' ||
                order.status === 'DELIVERY'
              ? 'em-producao'
              : 'aguardando';

      return {
        id: order.id,
        clientName: q.client?.name || 'Cliente não informado',
        serviceDescription: `${q.quotationNumber || ''}-${q.series?.code || ''} - ${q.description || ''}`,
        approvedDate: q.approvedAt ? format(q.approvedAt, 'dd/MM/yyyy') : null,
        dueDate: q.dueDate ? format(q.dueDate, 'dd/MM/yyyy') : '-',
        value: q.totalValue || 0,
        phase,
        phasePercentage:
          phase === 'entregue' ? 100 : phase === 'em-producao' ? 50 : 0,
      };
    };

    if (groupBy === 'client') {
      // Group ALL records by client
      const recordsByClient: Record<
        string,
        { clientId: string; clientName: string; records: SaleRecordItem[] }
      > = {};

      orders.forEach((order) => {
        const record = mapToRecord(order);
        const clientId = order.quotation.clientId || 'no-client';
        const clientName = record.clientName;

        if (!recordsByClient[clientId]) {
          recordsByClient[clientId] = { clientId, clientName, records: [] };
        }
        recordsByClient[clientId].records.push(record);
      });

      const allGroups: SalesClientGroup[] = Object.values(recordsByClient).map(
        (g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
          records: g.records,
        }),
      );

      // Paginate at the group level
      const totalGroups = allGroups.length;
      const groups = allGroups.slice((page - 1) * limit, page * limit);
      const pagination = {
        page,
        totalPages: Math.ceil(totalGroups / limit),
        totalRecords: totalGroups,
      };

      return { grouped: true, groups, totalCount, pagination };
    } else if (groupBy === 'seller') {
      // Group ALL records by seller
      const recordsBySeller: Record<
        string,
        { sellerId: string; sellerName: string; records: SaleRecordItem[] }
      > = {};

      orders.forEach((order) => {
        const record = mapToRecord(order);
        const sellerId = order.quotation.sellerId || 'no-seller';
        const seller = order.quotation.seller;
        const sellerName = seller?.name || 'Vendedor não informado';

        if (!recordsBySeller[sellerId]) {
          recordsBySeller[sellerId] = { sellerId, sellerName, records: [] };
        }
        recordsBySeller[sellerId].records.push(record);
      });

      const allGroups: SalesSellerGroup[] = Object.values(recordsBySeller).map(
        (g) => ({
          sellerId: g.sellerId,
          sellerName: g.sellerName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
          records: g.records,
        }),
      );

      // Paginate at the group level
      const totalGroups = allGroups.length;
      const groups = allGroups.slice((page - 1) * limit, page * limit);
      const pagination = {
        page,
        totalPages: Math.ceil(totalGroups / limit),
        totalRecords: totalGroups,
      };

      return { grouped: true, groups, totalCount, pagination };
    } else {
      const records = orders.map(mapToRecord);
      const pagination = {
        page,
        totalPages: Math.ceil(totalCount / limit),
        totalRecords: totalCount,
      };
      return { grouped: false, records, totalCount, pagination };
    }
  }

  async getSalesReportPdfData(
    companyId: string,
    filters: SalesReportFilterDto,
  ) {
    const { startDate, endDate } = this.getDateRange(filters);

    // Get company info
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        address: true,
      },
    });

    // Get all orders for the period (no pagination for PDF)
    const orders = await this.prisma.order.findMany({
      where: {
        status: { not: 'CANCELED' },
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          include: {
            client: { select: { id: true, name: true } },
            series: { select: { code: true } },
          },
        },
      },
      orderBy: { quotation: { approvedAt: 'desc' } },
    });

    // Calculate total value
    const totalValue = orders.reduce(
      (sum, o) => sum + (o.quotation.totalValue || 0),
      0,
    );

    // Group by client
    const groupsMap: Record<
      string,
      {
        clientId: string;
        clientName: string;
        records: any[];
        total: number;
      }
    > = {};

    orders.forEach((order) => {
      const q = order.quotation;
      const clientId = q.clientId || 'no-client';
      const clientName = q.client?.name || 'Cliente não informado';

      if (!groupsMap[clientId]) {
        groupsMap[clientId] = {
          clientId,
          clientName,
          records: [],
          total: 0,
        };
      }

      const phase =
        order.status === 'FINISHED'
          ? 'Entregue'
          : order.status === 'IN_PRODUCTION' ||
              order.status === 'COMPLETED' ||
              order.status === 'DELIVERY'
            ? 'Em produção'
            : 'Fase atual';

      const value = q.totalValue || 0;
      const percentage =
        totalValue > 0
          ? parseFloat(((value / totalValue) * 100).toFixed(1))
          : 0;

      groupsMap[clientId].records.push({
        id: order.id,
        clientName,
        serviceCode: `${q.series?.code || ''}-${q.quotationNumber || ''}`,
        description: q.description || 'Descrição do serviço',
        approvedDate: q.approvedAt ? format(q.approvedAt, 'dd/MM/yyyy') : null,
        phase,
        value,
        percentage,
      });

      groupsMap[clientId].total += value;
    });

    const groups = Object.values(groupsMap).map((g) => ({
      ...g,
      count: g.records.length,
      percentage:
        totalValue > 0
          ? parseFloat(((g.total / totalValue) * 100).toFixed(1))
          : 0,
    }));

    // Get first address from array
    const companyAddress = company?.address?.[0];

    return {
      company: {
        name: company?.name,
        cnpj: company?.cnpj,
        logoUrl: company?.logoUrl,
        email: company?.email,
        siteUrl: company?.siteUrl,
        phone: company?.phone,
        address: companyAddress
          ? {
              street: companyAddress.street,
              number: companyAddress.number,
              neighborhood: companyAddress.neighborhood,
              city: companyAddress.city,
              state: companyAddress.state,
            }
          : undefined,
        socialNetworks: {
          instagram: company?.instagram,
          facebook: company?.facebook,
          linkedin: company?.linkedin,
        },
      },
      sellerName: filters.sellerId ? 'Vendedor' : undefined,
      totalValue,
      totalPercentage: 100,
      groups,
    };
  }

  // ============== SECTOR REPORT ==============

  async getSectorResults(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<{
    sectors: {
      id: string;
      name: string;
      icon: string;
      value: number;
    }[];
    generalTotal: number;
  }> {
    const { startDate, endDate } = this.getDateRange(filters);

    // Fetch all active sectors for the company
    const activeSectors = await this.prisma.companySector.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, icon: true },
      orderBy: { name: 'asc' },
    });

    const orderProducts = await this.prisma.quotationProduct.findMany({
      where: {
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          order: { isNot: null },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        product: {
          select: {
            sectorId: true,
          },
        },
      },
    });

    // Initialize all active sectors with value 0
    const sectorTotals: Record<
      string,
      { id: string; name: string; icon: string; value: number }
    > = {};

    activeSectors.forEach((sector) => {
      sectorTotals[sector.id] = {
        id: sector.id,
        name: sector.name,
        icon: sector.icon || '',
        value: 0,
      };
    });

    // Aggregate sales by sector
    let generalTotal = 0;

    orderProducts.forEach((qp) => {
      const value = qp.finalValue ?? qp.totalValue ?? 0;
      generalTotal += value;

      const sectorId = qp.product?.sectorId;
      if (!sectorId || !sectorTotals[sectorId]) return;

      sectorTotals[sectorId].value += value;
    });

    const sectors = Object.values(sectorTotals).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return { sectors, generalTotal };
  }

  async getSectorResultsPdfData(
    companyId: string,
    filters: SalesReportFilterDto,
  ) {
    const sectorData = await this.getSectorResults(companyId, filters);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true },
    });

    const companyAddress = company?.address?.[0];

    return {
      company: {
        name: company?.name,
        cnpj: company?.cnpj,
        logoUrl: company?.logoUrl,
        email: company?.email,
        siteUrl: company?.siteUrl,
        phone: company?.phone,
        address: companyAddress
          ? {
              street: companyAddress.street,
              number: companyAddress.number,
              neighborhood: companyAddress.neighborhood,
              city: companyAddress.city,
              state: companyAddress.state,
            }
          : undefined,
        socialNetworks: {
          instagram: company?.instagram,
          facebook: company?.facebook,
          linkedin: company?.linkedin,
        },
      },
      sectors: sectorData.sectors,
      generalTotal: sectorData.generalTotal,
    };
  }

  // ============== FINANCIAL REPORT METHODS ==============

  private getFinancialDateRange(filters: {
    startDate?: string;
    endDate?: string;
  }) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(now);
    const endDate = filters.endDate
      ? new Date(filters.endDate)
      : endOfMonth(now);
    return { startDate, endDate };
  }

  private getInstallmentStatus(installment: {
    paidDate: Date | null;
    provisionDate: Date | null;
    dueDate: Date;
    status: string;
  }): 'received' | 'confirmed' | 'to_receive' | 'overdue' {
    if (installment.status === 'PAID' || installment.paidDate)
      return 'received';
    if (installment.status === 'PROVISIONED' || installment.provisionDate)
      return 'confirmed';
    if (installment.status === 'OVERDUE' || installment.dueDate < new Date())
      return 'overdue';
    return 'to_receive';
  }

  async getFinancialSummary(
    companyId: string,
    filters: FinancialReportFilterDto,
  ) {
    const { startDate, endDate } = this.getFinancialDateRange(filters);
    const isReceitas = filters.tab !== 'despesas';

    if (isReceitas) {
      const installments = await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: {
            companyId,
            status: { not: 'CANCELED' },
          },
          OR: [
            { dueDate: { gte: startDate, lte: endDate } },
            { paidDate: { gte: startDate, lte: endDate } },
          ],
        },
      });

      const result = {
        received: 0,
        confirmed: 0,
        toReceive: 0,
        overdue: 0,
        receivedCount: 0,
        confirmedCount: 0,
        toReceiveCount: 0,
        overdueCount: 0,
      };

      installments.forEach((inst) => {
        const status = this.getInstallmentStatus(inst);
        const amount = inst.paidAmount || inst.amount;
        const isPaidInPeriod =
          inst.paidDate &&
          inst.paidDate >= startDate &&
          inst.paidDate <= endDate;
        const isDueInPeriod =
          inst.dueDate >= startDate && inst.dueDate <= endDate;

        if (status === 'received') {
          if (isPaidInPeriod) {
            result.received += amount;
            result.receivedCount++;
          }
        } else if (isDueInPeriod) {
          if (status === 'confirmed') {
            result.confirmed += amount;
            result.confirmedCount++;
          } else if (status === 'overdue') {
            result.overdue += amount;
            result.overdueCount++;
          } else {
            result.toReceive += amount;
            result.toReceiveCount++;
          }
        }
      });

      return result;
    } else {
      const installments = await this.prisma.payableInstallment.findMany({
        where: {
          payable: {
            companyId,
            status: { not: 'CANCELED' },
          },
          OR: [
            { dueDate: { gte: startDate, lte: endDate } },
            { paidDate: { gte: startDate, lte: endDate } },
          ],
        },
      });

      const result = {
        received: 0,
        confirmed: 0,
        toReceive: 0,
        overdue: 0,
        receivedCount: 0,
        confirmedCount: 0,
        toReceiveCount: 0,
        overdueCount: 0,
      };

      installments.forEach((inst) => {
        const status = this.getInstallmentStatus(inst);
        const amount = inst.paidAmount || inst.amount;
        const isPaidInPeriod =
          inst.paidDate &&
          inst.paidDate >= startDate &&
          inst.paidDate <= endDate;
        const isDueInPeriod =
          inst.dueDate >= startDate && inst.dueDate <= endDate;

        if (status === 'received') {
          if (isPaidInPeriod) {
            result.received += amount;
            result.receivedCount++;
          }
        } else if (isDueInPeriod) {
          if (status === 'confirmed') {
            result.confirmed += amount;
            result.confirmedCount++;
          } else if (status === 'overdue') {
            result.overdue += amount;
            result.overdueCount++;
          } else {
            result.toReceive += amount;
            result.toReceiveCount++;
          }
        }
      });

      return result;
    }
  }

  async getFinancialChart(
    companyId: string,
    filters: FinancialReportFilterDto,
  ) {
    const { startDate, endDate } = this.getFinancialDateRange(filters);
    const isReceitas = filters.tab !== 'despesas';

    const installments = isReceitas
      ? await this.prisma.receivableInstallment.findMany({
          where: {
            receivable: { companyId, status: { not: 'CANCELED' } },
            OR: [
              { dueDate: { gte: startDate, lte: endDate } },
              { paidDate: { gte: startDate, lte: endDate } },
            ],
          },
        })
      : await this.prisma.payableInstallment.findMany({
          where: {
            payable: { companyId, status: { not: 'CANCELED' } },
            OR: [
              { dueDate: { gte: startDate, lte: endDate } },
              { paidDate: { gte: startDate, lte: endDate } },
            ],
          },
        });

    // Group by day
    const dailyData: Record<
      string,
      {
        date: string;
        label: string;
        received: number;
        confirmed: number;
        toReceive: number;
        overdue: number;
        receivedCount: number;
        confirmedCount: number;
        toReceiveCount: number;
        overdueCount: number;
      }
    > = {};

    installments.forEach((inst: any) => {
      const status = this.getInstallmentStatus(inst);
      const isPaidInPeriod =
        inst.paidDate && inst.paidDate >= startDate && inst.paidDate <= endDate;
      const isDueInPeriod =
        inst.dueDate >= startDate && inst.dueDate <= endDate;

      // Se for recebido, plotamos no dia do recebimento (se caiu dentro do período)
      // Se não, plotamos no dia do vencimento (se caiu dentro do período)
      let targetDate: Date | null = null;
      let validAction = false;

      if (status === 'received') {
        if (isPaidInPeriod) {
          targetDate = inst.paidDate;
          validAction = true;
        }
      } else if (isDueInPeriod) {
        targetDate = inst.dueDate;
        validAction = true;
      }

      if (!validAction || !targetDate) return;

      const dayKey = format(targetDate, 'yyyy-MM-dd');
      const label = format(targetDate, 'd/MMM', { locale: ptBR });

      if (!dailyData[dayKey]) {
        dailyData[dayKey] = {
          date: dayKey,
          label,
          received: 0,
          confirmed: 0,
          toReceive: 0,
          overdue: 0,
          receivedCount: 0,
          confirmedCount: 0,
          toReceiveCount: 0,
          overdueCount: 0,
        };
      }

      const key = status === 'to_receive' ? 'toReceive' : status;
      const amount = inst.paidAmount || inst.amount;
      dailyData[dayKey][key] += amount;
      const countKey = `${key}Count` as keyof (typeof dailyData)[string];
      (dailyData[dayKey][countKey] as number) += 1;
    });

    const result = Object.values(dailyData).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return result;
  }

  async getFinancialPdfData(
    companyId: string,
    filters: FinancialReportFilterDto,
  ) {
    const { startDate, endDate } = this.getFinancialDateRange(filters);
    const isReceitas = filters.tab !== 'despesas';
    const statusFilter = filters.status || 'all';

    // Get company info
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true },
    });

    if (isReceitas) {
      const where: any = {
        receivable: {
          companyId,
          status: { not: 'CANCELED' },
        },
        OR: [
          { dueDate: { gte: startDate, lte: endDate } },
          { paidDate: { gte: startDate, lte: endDate } },
        ],
      };

      if (statusFilter === 'received') where.status = 'PAID';
      else if (statusFilter === 'confirmed') where.status = 'PROVISIONED';

      const allInstallments = await this.prisma.receivableInstallment.findMany({
        where,
        include: {
          receivable: {
            include: {
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      let records = allInstallments
        .map((inst) => {
          const computedStatus = this.getInstallmentStatus(inst);
          const isPaidInPeriod =
            inst.paidDate &&
            inst.paidDate >= startDate &&
            inst.paidDate <= endDate;
          const isDueInPeriod =
            inst.dueDate &&
            inst.dueDate >= startDate &&
            inst.dueDate <= endDate;

          let validAction = false;
          if (computedStatus === 'received') {
            if (isPaidInPeriod) validAction = true;
          } else if (isDueInPeriod) {
            validAction = true;
          }

          if (!validAction) return null;

          return {
            id: inst.id,
            clientId: inst.receivable.clientId || '',
            clientName: inst.receivable.client?.name || 'Não informado',
            description: inst.receivable.description || 'Sem descrição',
            dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
            receivedDate: inst.paidDate
              ? format(inst.paidDate, 'dd/MM/yyyy')
              : null,
            value: inst.paidAmount || inst.amount,
            status: computedStatus,
          };
        })
        .filter(Boolean) as any[];

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      }

      const totalValue = records.reduce((sum, r) => sum + r.value, 0);

      // Group by client
      const groupsMap: Record<
        string,
        {
          clientId: string;
          clientName: string;
          records: typeof records;
          total: number;
        }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.clientId]) {
          groupsMap[r.clientId] = {
            clientId: r.clientId,
            clientName: r.clientName,
            records: [],
            total: 0,
          };
        }
        groupsMap[r.clientId].records.push({
          ...r,
          percentage: 0,
        } as any);
        groupsMap[r.clientId].total += r.value;
      });

      const groups = Object.values(groupsMap).map((g) => {
        const groupPct =
          totalValue > 0
            ? parseFloat(((g.total / totalValue) * 100).toFixed(1))
            : 0;
        return {
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.total,
          percentage: groupPct,
          records: g.records.map((r) => ({
            ...r,
            percentage:
              totalValue > 0
                ? parseFloat(((r.value / totalValue) * 100).toFixed(1))
                : 0,
          })),
        };
      });

      const companyAddress = company?.address?.[0];

      return {
        company: {
          name: company?.name,
          cnpj: company?.cnpj,
          logoUrl: company?.logoUrl,
          email: company?.email,
          siteUrl: company?.siteUrl,
          phone: company?.phone,
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
              }
            : undefined,
          socialNetworks: {
            instagram: company?.instagram,
            facebook: company?.facebook,
            linkedin: company?.linkedin,
          },
        },
        tab: filters.tab || 'receitas',
        status: statusFilter !== 'all' ? statusFilter : '',
        totalValue,
        totalPercentage: 100,
        groups,
      };
    } else {
      // Despesas
      const where: any = {
        payable: {
          companyId,
          status: { not: 'CANCELED' },
        },
        OR: [
          { dueDate: { gte: startDate, lte: endDate } },
          { paidDate: { gte: startDate, lte: endDate } },
        ],
      };

      if (statusFilter === 'received') where.status = 'PAID';
      else if (statusFilter === 'confirmed') where.status = 'PROVISIONED';

      const allInstallments = await this.prisma.payableInstallment.findMany({
        where,
        include: {
          payable: {
            include: {
              supplier: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      let records = allInstallments
        .map((inst) => {
          const computedStatus = this.getInstallmentStatus(inst);
          const isPaidInPeriod =
            inst.paidDate &&
            inst.paidDate >= startDate &&
            inst.paidDate <= endDate;
          const isDueInPeriod =
            inst.dueDate &&
            inst.dueDate >= startDate &&
            inst.dueDate <= endDate;

          let validAction = false;
          if (computedStatus === 'received') {
            if (isPaidInPeriod) validAction = true;
          } else if (isDueInPeriod) {
            validAction = true;
          }

          if (!validAction) return null;

          const entityName =
            inst.payable.supplier?.name ||
            inst.payable.client?.name ||
            'Não informado';
          const entityId =
            inst.payable.supplierId || inst.payable.clientId || '';
          return {
            id: inst.id,
            clientId: entityId,
            clientName: entityName,
            description: inst.payable.description || 'Sem descrição',
            dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
            receivedDate: inst.paidDate
              ? format(inst.paidDate, 'dd/MM/yyyy')
              : null,
            value: inst.paidAmount || inst.amount,
            status: computedStatus,
          };
        })
        .filter(Boolean) as any[];

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      }

      const totalValue = records.reduce((sum, r) => sum + r.value, 0);

      const groupsMap: Record<
        string,
        {
          clientId: string;
          clientName: string;
          records: typeof records;
          total: number;
        }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.clientId]) {
          groupsMap[r.clientId] = {
            clientId: r.clientId,
            clientName: r.clientName,
            records: [],
            total: 0,
          };
        }
        groupsMap[r.clientId].records.push({
          ...r,
          percentage: 0,
        } as any);
        groupsMap[r.clientId].total += r.value;
      });

      const groups = Object.values(groupsMap).map((g) => {
        const groupPct =
          totalValue > 0
            ? parseFloat(((g.total / totalValue) * 100).toFixed(1))
            : 0;
        return {
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.total,
          percentage: groupPct,
          records: g.records.map((r) => ({
            ...r,
            percentage:
              totalValue > 0
                ? parseFloat(((r.value / totalValue) * 100).toFixed(1))
                : 0,
          })),
        };
      });

      const companyAddress = company?.address?.[0];

      return {
        company: {
          name: company?.name,
          cnpj: company?.cnpj,
          logoUrl: company?.logoUrl,
          email: company?.email,
          siteUrl: company?.siteUrl,
          phone: company?.phone,
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
              }
            : undefined,
          socialNetworks: {
            instagram: company?.instagram,
            facebook: company?.facebook,
            linkedin: company?.linkedin,
          },
        },
        tab: filters.tab || 'despesas',
        status: statusFilter !== 'all' ? statusFilter : '',
        totalValue,
        totalPercentage: 100,
        groups,
      };
    }
  }

  async getAdvancedFinancialPdfData(
    companyId: string,
    filters: AdvancedFinancialReportFilterDto,
  ) {
    const { startDate, endDate } = this.getFinancialDateRange(filters);
    const isReceitas = filters.tab !== 'despesas';
    const statusFilter = filters.status || 'all';
    const periodType = filters.periodType || 'dueDate';
    const includeTransfers = filters.includeTransfers !== 'no';

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true },
    });

    const buildDateFilter = () => {
      switch (periodType) {
        case 'emission':
          return {
            receivable: { referenceDate: { gte: startDate, lte: endDate } },
          };
        case 'payment':
          return { paidDate: { gte: startDate, lte: endDate } };
        case 'cancel':
          return { dueDate: { gte: startDate, lte: endDate } };
        case 'dueDate':
        default:
          return { dueDate: { gte: startDate, lte: endDate } };
      }
    };

    const buildDateFilterDespesas = () => {
      switch (periodType) {
        case 'emission':
          return {
            payable: { referenceDate: { gte: startDate, lte: endDate } },
          };
        case 'payment':
          return { paidDate: { gte: startDate, lte: endDate } };
        case 'cancel':
          return { dueDate: { gte: startDate, lte: endDate } };
        case 'dueDate':
        default:
          return { dueDate: { gte: startDate, lte: endDate } };
      }
    };

    if (isReceitas) {
      const receivableWhere: any = {
        companyId,
        ...(periodType === 'cancel'
          ? { status: 'CANCELED' }
          : { status: { not: 'CANCELED' } }),
      };

      if (!includeTransfers) {
        receivableWhere.financialType = 'MAIN';
      }
      if (filters.natureId) {
        receivableWhere.natureId = filters.natureId;
      }
      if (filters.clientId) {
        receivableWhere.clientId = filters.clientId;
      }

      const where: any = {
        receivable: receivableWhere,
        ...buildDateFilter(),
      };

      if (filters.bankAccountId) {
        where.bankAccountId = filters.bankAccountId;
      }
      if (filters.paymentConditionId) {
        where.paymentConditionId = filters.paymentConditionId;
      }

      if (statusFilter === 'received') where.status = 'PAID';
      else if (statusFilter === 'confirmed') where.status = 'PROVISIONED';

      const allInstallments = await this.prisma.receivableInstallment.findMany({
        where,
        include: {
          receivable: {
            include: {
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      let records = allInstallments.map((inst) => {
        const computedStatus = this.getInstallmentStatus(inst);
        return {
          id: inst.id,
          clientId: inst.receivable.clientId || '',
          clientName: inst.receivable.client?.name || 'Não informado',
          description: inst.receivable.description || 'Sem descrição',
          dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
          receivedDate: inst.paidDate
            ? format(inst.paidDate, 'dd/MM/yyyy')
            : null,
          value: inst.paidAmount || inst.amount,
          status: computedStatus,
        };
      });

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      }

      const totalValue = records.reduce((sum, r) => sum + r.value, 0);

      const groupsMap: Record<
        string,
        {
          clientId: string;
          clientName: string;
          records: typeof records;
          total: number;
        }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.clientId]) {
          groupsMap[r.clientId] = {
            clientId: r.clientId,
            clientName: r.clientName,
            records: [],
            total: 0,
          };
        }
        groupsMap[r.clientId].records.push({
          ...r,
          percentage: 0,
        } as any);
        groupsMap[r.clientId].total += r.value;
      });

      const groups = Object.values(groupsMap).map((g) => {
        const groupPct =
          totalValue > 0
            ? parseFloat(((g.total / totalValue) * 100).toFixed(1))
            : 0;
        return {
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.total,
          percentage: groupPct,
          records: g.records.map((r) => ({
            ...r,
            percentage:
              totalValue > 0
                ? parseFloat(((r.value / totalValue) * 100).toFixed(1))
                : 0,
          })),
        };
      });

      const companyAddress = company?.address?.[0];

      return {
        company: {
          name: company?.name,
          cnpj: company?.cnpj,
          logoUrl: company?.logoUrl,
          email: company?.email,
          siteUrl: company?.siteUrl,
          phone: company?.phone,
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
              }
            : undefined,
          socialNetworks: {
            instagram: company?.instagram,
            facebook: company?.facebook,
            linkedin: company?.linkedin,
          },
        },
        tab: filters.tab || 'receitas',
        status: statusFilter !== 'all' ? statusFilter : '',
        totalValue,
        totalPercentage: 100,
        groups,
      };
    } else {
      // Despesas
      const payableWhere: any = {
        companyId,
        ...(periodType === 'cancel'
          ? { status: 'CANCELED' }
          : { status: { not: 'CANCELED' } }),
      };

      if (!includeTransfers) {
        payableWhere.financialType = 'MAIN';
      }
      if (filters.natureId) {
        payableWhere.natureId = filters.natureId;
      }
      if (filters.clientId) {
        payableWhere.supplierId = filters.clientId;
      }

      const where: any = {
        payable: payableWhere,
        ...buildDateFilterDespesas(),
      };

      if (filters.bankAccountId) {
        where.bankAccountId = filters.bankAccountId;
      }
      if (filters.paymentConditionId) {
        where.paymentConditionId = filters.paymentConditionId;
      }

      if (statusFilter === 'received') where.status = 'PAID';
      else if (statusFilter === 'confirmed') where.status = 'PROVISIONED';

      const allInstallments = await this.prisma.payableInstallment.findMany({
        where,
        include: {
          payable: {
            include: {
              supplier: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      let records = allInstallments.map((inst) => {
        const computedStatus = this.getInstallmentStatus(inst);
        const entityName =
          inst.payable.supplier?.name ||
          inst.payable.client?.name ||
          'Não informado';
        const entityId = inst.payable.supplierId || inst.payable.clientId || '';
        return {
          id: inst.id,
          clientId: entityId,
          clientName: entityName,
          description: inst.payable.description || 'Sem descrição',
          dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
          receivedDate: inst.paidDate
            ? format(inst.paidDate, 'dd/MM/yyyy')
            : null,
          value: inst.paidAmount || inst.amount,
          status: computedStatus,
        };
      });

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      }

      const totalValue = records.reduce((sum, r) => sum + r.value, 0);

      const groupsMap: Record<
        string,
        {
          clientId: string;
          clientName: string;
          records: typeof records;
          total: number;
        }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.clientId]) {
          groupsMap[r.clientId] = {
            clientId: r.clientId,
            clientName: r.clientName,
            records: [],
            total: 0,
          };
        }
        groupsMap[r.clientId].records.push({
          ...r,
          percentage: 0,
        } as any);
        groupsMap[r.clientId].total += r.value;
      });

      const groups = Object.values(groupsMap).map((g) => {
        const groupPct =
          totalValue > 0
            ? parseFloat(((g.total / totalValue) * 100).toFixed(1))
            : 0;
        return {
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.total,
          percentage: groupPct,
          records: g.records.map((r) => ({
            ...r,
            percentage:
              totalValue > 0
                ? parseFloat(((r.value / totalValue) * 100).toFixed(1))
                : 0,
          })),
        };
      });

      const companyAddress = company?.address?.[0];

      return {
        company: {
          name: company?.name,
          cnpj: company?.cnpj,
          logoUrl: company?.logoUrl,
          email: company?.email,
          siteUrl: company?.siteUrl,
          phone: company?.phone,
          address: companyAddress
            ? {
                street: companyAddress.street,
                number: companyAddress.number,
                neighborhood: companyAddress.neighborhood,
                city: companyAddress.city,
                state: companyAddress.state,
              }
            : undefined,
          socialNetworks: {
            instagram: company?.instagram,
            facebook: company?.facebook,
            linkedin: company?.linkedin,
          },
        },
        tab: filters.tab || 'despesas',
        status: statusFilter !== 'all' ? statusFilter : '',
        totalValue,
        totalPercentage: 100,
        groups,
      };
    }
  }

  async getFinancialTable(
    companyId: string,
    filters: FinancialReportFilterDto,
  ) {
    const { startDate, endDate } = this.getFinancialDateRange(filters);
    const isReceitas = filters.tab !== 'despesas';
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const groupBy = filters.groupBy || 'none';
    const statusFilter = filters.status || 'all';
    const isGrouped = groupBy === 'client';

    if (isReceitas) {
      // Build where clause
      const where: any = {
        receivable: {
          companyId,
          status: { not: 'CANCELED' },
        },
        OR: [
          { dueDate: { gte: startDate, lte: endDate } },
          { paidDate: { gte: startDate, lte: endDate } },
        ],
      };

      // Apply status filter at DB level where possible
      // Note: 'overdue' and 'to_receive' use runtime check (getInstallmentStatus)
      // because DB status may still be PENDING for overdue installments
      if (statusFilter === 'received') {
        where.status = 'PAID';
      } else if (statusFilter === 'confirmed') {
        where.status = 'PROVISIONED';
      }

      const allInstallments = await this.prisma.receivableInstallment.findMany({
        where,
        include: {
          receivable: {
            include: {
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      // Map records WITHOUT percentage (calculated after filtering)
      let records = allInstallments
        .map((inst) => {
          const computedStatus = this.getInstallmentStatus(inst);
          const isPaidInPeriod =
            inst.paidDate &&
            inst.paidDate >= startDate &&
            inst.paidDate <= endDate;
          const isDueInPeriod =
            inst.dueDate &&
            inst.dueDate >= startDate &&
            inst.dueDate <= endDate;

          let validAction = false;
          if (computedStatus === 'received') {
            if (isPaidInPeriod) validAction = true;
          } else if (isDueInPeriod) {
            validAction = true;
          }

          if (!validAction) return null;

          return {
            id: inst.id,
            clientId: inst.receivable.clientId || '',
            clientName: inst.receivable.client?.name || 'Não informado',
            description: inst.receivable.description || 'Sem descrição',
            dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
            receivedDate: inst.paidDate
              ? format(inst.paidDate, 'dd/MM/yyyy')
              : null,
            value: inst.paidAmount || inst.amount,
            percentage: 0,
            status: computedStatus,
          };
        })
        .filter(Boolean) as any[];

      // Post-filter for statuses that require runtime check
      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      } else if (
        statusFilter !== 'all' &&
        statusFilter !== 'received' &&
        statusFilter !== 'confirmed'
      ) {
        records = records.filter((r) => r.status === statusFilter);
      }

      // Calculate totalValue ONCE from filtered records
      const totalValue = records.reduce((sum, r) => sum + r.value, 0);
      const totalCount = records.length;

      if (isGrouped) {
        // Group by client
        const groupsMap: Record<
          string,
          { clientId: string; clientName: string; records: typeof records }
        > = {};

        records.forEach((r) => {
          if (!groupsMap[r.clientId]) {
            groupsMap[r.clientId] = {
              clientId: r.clientId,
              clientName: r.clientName,
              records: [],
            };
          }
          groupsMap[r.clientId].records.push(r);
        });

        const allGroups = Object.values(groupsMap).map((g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
          records: g.records,
        }));

        // Paginate at GROUP level (like sales report)
        const totalGroups = allGroups.length;
        const groups = allGroups.slice((page - 1) * limit, page * limit);

        return {
          grouped: true,
          records: [],
          groups,
          totalCount,
          totalValue,
          pagination: {
            page,
            totalPages: Math.ceil(totalGroups / limit),
            totalRecords: totalGroups,
          },
        };
      } else {
        const paginatedRecords = records.slice(
          (page - 1) * limit,
          page * limit,
        );
        return {
          grouped: false,
          records: paginatedRecords,
          totalCount,
          totalValue,
          pagination: {
            page,
            totalPages: Math.ceil(totalCount / limit),
            totalRecords: totalCount,
          },
        };
      }
    } else {
      // Despesas (Payable)
      const where: any = {
        payable: {
          companyId,
          status: { not: 'CANCELED' },
        },
        OR: [
          { dueDate: { gte: startDate, lte: endDate } },
          { paidDate: { gte: startDate, lte: endDate } },
        ],
      };

      // Note: 'overdue' and 'to_receive' use runtime check
      if (statusFilter === 'received') {
        where.status = 'PAID';
      } else if (statusFilter === 'confirmed') {
        where.status = 'PROVISIONED';
      }

      const allInstallments = await this.prisma.payableInstallment.findMany({
        where,
        include: {
          payable: {
            include: {
              supplier: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: this.getFinancialOrderBy(filters.orderBy),
      });

      // Map records WITHOUT percentage
      let records = allInstallments
        .map((inst) => {
          const computedStatus = this.getInstallmentStatus(inst);
          const isPaidInPeriod =
            inst.paidDate &&
            inst.paidDate >= startDate &&
            inst.paidDate <= endDate;
          const isDueInPeriod =
            inst.dueDate &&
            inst.dueDate >= startDate &&
            inst.dueDate <= endDate;

          let validAction = false;
          if (computedStatus === 'received') {
            if (isPaidInPeriod) validAction = true;
          } else if (isDueInPeriod) {
            validAction = true;
          }

          if (!validAction) return null;

          const entityName =
            inst.payable.supplier?.name ||
            inst.payable.client?.name ||
            'Não informado';
          const entityId =
            inst.payable.supplierId || inst.payable.clientId || '';

          return {
            id: inst.id,
            clientId: entityId,
            clientName: entityName,
            description: inst.payable.description || 'Sem descrição',
            dueDate: inst.dueDate ? format(inst.dueDate, 'dd/MM/yyyy') : null,
            receivedDate: inst.paidDate
              ? format(inst.paidDate, 'dd/MM/yyyy')
              : null,
            value: inst.paidAmount || inst.amount,
            percentage: 0,
            status: computedStatus,
          };
        })
        .filter(Boolean) as any[];

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (statusFilter === 'overdue') {
        records = records.filter((r) => r.status === 'overdue');
      }

      // Calculate totalValue ONCE from filtered records
      const totalValue = records.reduce((sum, r) => sum + r.value, 0);
      const totalCount = records.length;

      if (isGrouped) {
        const groupsMap: Record<
          string,
          { clientId: string; clientName: string; records: typeof records }
        > = {};

        records.forEach((r) => {
          if (!groupsMap[r.clientId]) {
            groupsMap[r.clientId] = {
              clientId: r.clientId,
              clientName: r.clientName,
              records: [],
            };
          }
          groupsMap[r.clientId].records.push(r);
        });

        const allGroups = Object.values(groupsMap).map((g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
          records: g.records,
        }));

        // Paginate at GROUP level
        const totalGroups = allGroups.length;
        const groups = allGroups.slice((page - 1) * limit, page * limit);

        return {
          grouped: true,
          records: [],
          groups,
          totalCount,
          totalValue,
          pagination: {
            page,
            totalPages: Math.ceil(totalGroups / limit),
            totalRecords: totalGroups,
          },
        };
      } else {
        const paginatedRecords = records.slice(
          (page - 1) * limit,
          page * limit,
        );
        return {
          grouped: false,
          records: paginatedRecords,
          totalCount,
          totalValue,
          pagination: {
            page,
            totalPages: Math.ceil(totalCount / limit),
            totalRecords: totalCount,
          },
        };
      }
    }
  }

  private getFinancialOrderBy(orderBy?: string): any {
    switch (orderBy) {
      case 'saleDate':
        return { createdAt: 'desc' };
      case 'valueDesc':
        return { amount: 'desc' };
      case 'valueAsc':
        return { amount: 'asc' };
      case 'receivedDate':
        return { paidDate: 'desc' };
      default:
        return { dueDate: 'desc' };
    }
  }

  // ============== CASH FLOW PDF/EXPORT ==============

  async getCashFlowPdfData(
    companyId: string,
    filters: CashFlowReportFilterDto,
  ) {
    const { startDate, endDate } = this.getCashFlowDateRange(filters);
    const movement = filters.movement || 'all';

    // Get company info
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { address: true },
    });

    const allRecords: Array<{
      id: string;
      clientName: string;
      description: string;
      dueDate: string;
      value: number;
      type: 'revenue' | 'expense';
    }> = [];

    if (movement !== 'expense') {
      const receivables = await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: { companyId, status: { not: 'CANCELED' } },
          dueDate: { gte: startDate, lte: endDate },
        },
        include: {
          receivable: {
            include: { client: { select: { id: true, name: true } } },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      allRecords.push(
        ...receivables.map((inst) => ({
          id: inst.id,
          clientName: inst.receivable.client?.name || 'Não informado',
          description: inst.receivable.description || 'Sem descrição',
          dueDate: format(inst.dueDate, 'dd/MM/yyyy'),
          value: inst.paidAmount || inst.amount,
          type: 'revenue' as const,
        })),
      );
    }

    if (movement !== 'revenue') {
      const payables = await this.prisma.payableInstallment.findMany({
        where: {
          payable: { companyId, status: { not: 'CANCELED' } },
          dueDate: { gte: startDate, lte: endDate },
        },
        include: {
          payable: {
            include: {
              supplier: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      allRecords.push(
        ...payables.map((inst) => ({
          id: inst.id,
          clientName:
            inst.payable.supplier?.name ||
            inst.payable.client?.name ||
            'Não informado',
          description: inst.payable.description || 'Sem descrição',
          dueDate: format(inst.dueDate, 'dd/MM/yyyy'),
          value: -(inst.paidAmount || inst.amount),
          type: 'expense' as const,
        })),
      );
    }

    const totalAbsValue = allRecords.reduce(
      (sum, r) => sum + Math.abs(r.value),
      0,
    );
    const totalRevenue = allRecords
      .filter((r) => r.type === 'revenue')
      .reduce((sum, r) => sum + r.value, 0);
    const totalExpenses = allRecords
      .filter((r) => r.type === 'expense')
      .reduce((sum, r) => sum + Math.abs(r.value), 0);

    const records = allRecords.map((r) => ({
      ...r,
      percentage:
        totalAbsValue > 0
          ? parseFloat(((Math.abs(r.value) / totalAbsValue) * 100).toFixed(1))
          : 0,
    }));

    // Group by date
    const groupsMap: Record<string, { date: string; records: typeof records }> =
      {};

    records.forEach((r) => {
      if (!groupsMap[r.dueDate]) {
        groupsMap[r.dueDate] = { date: r.dueDate, records: [] };
      }
      groupsMap[r.dueDate].records.push(r);
    });

    const groups = Object.values(groupsMap).map((g) => ({
      date: g.date,
      count: g.records.length,
      total: g.records.reduce((sum, r) => sum + r.value, 0),
      records: g.records,
    }));

    const companyAddress = company?.address?.[0];

    return {
      company: {
        name: company?.name,
        cnpj: company?.cnpj,
        logoUrl: company?.logoUrl,
        email: company?.email,
        siteUrl: company?.siteUrl,
        phone: company?.phone,
        address: companyAddress
          ? {
              street: companyAddress.street,
              number: companyAddress.number,
              neighborhood: companyAddress.neighborhood,
              city: companyAddress.city,
              state: companyAddress.state,
            }
          : undefined,
        socialNetworks: {
          instagram: company?.instagram,
          facebook: company?.facebook,
          linkedin: company?.linkedin,
        },
      },
      totalRevenue,
      totalExpenses,
      totalBalance: totalRevenue - totalExpenses,
      totalCount: records.length,
      groups,
    };
  }

  // ============== CASH FLOW REPORT METHODS ==============

  private getCashFlowDateRange(filters: CashFlowReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate ? new Date(filters.startDate) : now;
    const defaultEnd = new Date(now);
    defaultEnd.setDate(defaultEnd.getDate() + 7);
    const endDate = filters.endDate ? new Date(filters.endDate) : defaultEnd;
    return { startDate, endDate };
  }

  async getCashFlowSummary(
    companyId: string,
    filters: CashFlowReportFilterDto,
  ) {
    const { startDate, endDate } = this.getCashFlowDateRange(filters);

    // Get receivable installments (revenue)
    const receivableInstallments =
      await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: { companyId, status: { not: 'CANCELED' } },
          dueDate: { gte: startDate, lte: endDate },
        },
      });

    // Get payable installments (expenses)
    const payableInstallments = await this.prisma.payableInstallment.findMany({
      where: {
        payable: { companyId, status: { not: 'CANCELED' } },
        dueDate: { gte: startDate, lte: endDate },
      },
    });

    const expectedRevenue = receivableInstallments.reduce(
      (sum, inst) => sum + (inst.paidAmount || inst.amount),
      0,
    );

    const expectedExpenses = payableInstallments.reduce(
      (sum, inst) => sum + (inst.paidAmount || inst.amount),
      0,
    );

    return {
      expectedRevenue,
      expectedExpenses,
      expectedBalance: expectedRevenue - expectedExpenses,
    };
  }

  async getCashFlowChart(companyId: string, filters: CashFlowReportFilterDto) {
    const { startDate, endDate } = this.getCashFlowDateRange(filters);

    const receivableInstallments =
      await this.prisma.receivableInstallment.findMany({
        where: {
          receivable: { companyId, status: { not: 'CANCELED' } },
          dueDate: { gte: startDate, lte: endDate },
        },
      });

    const payableInstallments = await this.prisma.payableInstallment.findMany({
      where: {
        payable: { companyId, status: { not: 'CANCELED' } },
        dueDate: { gte: startDate, lte: endDate },
      },
    });

    // Group by day
    const dailyData: Record<
      string,
      { date: string; label: string; revenue: number; expenses: number }
    > = {};

    receivableInstallments.forEach((inst) => {
      const dayKey = format(inst.dueDate, 'yyyy-MM-dd');
      const label = format(inst.dueDate, 'dd MMM yy', { locale: ptBR });
      if (!dailyData[dayKey]) {
        dailyData[dayKey] = { date: dayKey, label, revenue: 0, expenses: 0 };
      }
      dailyData[dayKey].revenue += inst.paidAmount || inst.amount;
    });

    payableInstallments.forEach((inst) => {
      const dayKey = format(inst.dueDate, 'yyyy-MM-dd');
      const label = format(inst.dueDate, 'dd MMM yy', { locale: ptBR });
      if (!dailyData[dayKey]) {
        dailyData[dayKey] = { date: dayKey, label, revenue: 0, expenses: 0 };
      }
      dailyData[dayKey].expenses += inst.paidAmount || inst.amount;
    });

    // Calculate running balance
    const sorted = Object.values(dailyData).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    let runningBalance = 0;
    return sorted.map((day) => {
      runningBalance += day.revenue - day.expenses;
      return {
        ...day,
        balance: runningBalance,
      };
    });
  }

  async getCashFlowTable(companyId: string, filters: CashFlowReportFilterDto) {
    const { startDate, endDate } = this.getCashFlowDateRange(filters);
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const groupBy = filters.groupBy || 'none';
    const movement = filters.movement || 'all';

    // Build where clauses
    const receivableWhere: any = {
      receivable: { companyId, status: { not: 'CANCELED' } },
      dueDate: { gte: startDate, lte: endDate },
    };
    const payableWhere: any = {
      payable: { companyId, status: { not: 'CANCELED' } },
      dueDate: { gte: startDate, lte: endDate },
    };

    const orderBy = this.getFinancialOrderBy(filters.orderBy);

    // Fetch both based on movement filter
    const allRecords: Array<{
      id: string;
      clientId: string;
      clientName: string;
      description: string;
      dueDate: string;
      value: number;
      type: 'revenue' | 'expense';
    }> = [];

    if (movement !== 'expense') {
      const receivables = await this.prisma.receivableInstallment.findMany({
        where: receivableWhere,
        include: {
          receivable: {
            include: { client: { select: { id: true, name: true } } },
          },
        },
        orderBy,
      });

      allRecords.push(
        ...receivables.map((inst) => ({
          id: inst.id,
          clientId: inst.receivable.clientId || '',
          clientName: inst.receivable.client?.name || 'Não informado',
          description: inst.receivable.description || 'Sem descrição',
          dueDate: format(inst.dueDate, 'dd/MM/yyyy'),
          value: inst.paidAmount || inst.amount,
          type: 'revenue' as const,
        })),
      );
    }

    if (movement !== 'revenue') {
      const payables = await this.prisma.payableInstallment.findMany({
        where: payableWhere,
        include: {
          payable: {
            include: {
              supplier: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy,
      });

      allRecords.push(
        ...payables.map((inst) => ({
          id: inst.id,
          clientId: inst.payable.supplierId || inst.payable.clientId || '',
          clientName:
            inst.payable.supplier?.name ||
            inst.payable.client?.name ||
            'Não informado',
          description: inst.payable.description || 'Sem descrição',
          dueDate: format(inst.dueDate, 'dd/MM/yyyy'),
          value: -(inst.paidAmount || inst.amount),
          type: 'expense' as const,
        })),
      );
    }

    // Sort by client name if requested
    if (filters.orderBy === 'clientName') {
      allRecords.sort((a, b) => a.clientName.localeCompare(b.clientName));
    } else if (filters.orderBy === 'valueDesc') {
      allRecords.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    } else if (filters.orderBy === 'valueAsc') {
      allRecords.sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
    }

    // Calculate percentage
    const totalAbsValue = allRecords.reduce(
      (sum, r) => sum + Math.abs(r.value),
      0,
    );

    const records = allRecords.map((r) => ({
      ...r,
      percentage:
        totalAbsValue > 0
          ? parseFloat(((Math.abs(r.value) / totalAbsValue) * 100).toFixed(1))
          : 0,
    }));

    const totalCount = records.length;

    if (groupBy === 'date') {
      const groupsMap: Record<
        string,
        { date: string; records: typeof records }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.dueDate]) {
          groupsMap[r.dueDate] = { date: r.dueDate, records: [] };
        }
        groupsMap[r.dueDate].records.push(r);
      });

      const allGroups = Object.values(groupsMap).map((g) => ({
        date: g.date,
        count: g.records.length,
        total: g.records.reduce((sum, r) => sum + r.value, 0),
        records: g.records,
      }));

      const totalGroups = allGroups.length;
      const groups = allGroups.slice((page - 1) * limit, page * limit);

      return {
        grouped: true,
        records: [],
        groups,
        totalCount,
        pagination: {
          page,
          totalPages: Math.ceil(totalGroups / limit),
          totalRecords: totalGroups,
        },
      };
    } else if (groupBy === 'client') {
      const groupsMap: Record<
        string,
        { clientId: string; clientName: string; records: typeof records }
      > = {};

      records.forEach((r) => {
        if (!groupsMap[r.clientId]) {
          groupsMap[r.clientId] = {
            clientId: r.clientId,
            clientName: r.clientName,
            records: [],
          };
        }
        groupsMap[r.clientId].records.push(r);
      });

      const allGroups = Object.values(groupsMap).map((g) => ({
        date: '',
        clientId: g.clientId,
        clientName: g.clientName,
        count: g.records.length,
        total: g.records.reduce((sum, r) => sum + r.value, 0),
        records: g.records,
      }));

      const totalGroups = allGroups.length;
      const groups = allGroups.slice((page - 1) * limit, page * limit);

      return {
        grouped: true,
        records: [],
        groups,
        totalCount,
        pagination: {
          page,
          totalPages: Math.ceil(totalGroups / limit),
          totalRecords: totalGroups,
        },
      };
    } else {
      const paginatedRecords = records.slice((page - 1) * limit, page * limit);
      return {
        grouped: false,
        records: paginatedRecords,
        totalCount,
        pagination: {
          page,
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
        },
      };
    }
  }

  // ============== DFC REPORT METHODS ==============

  private getDfcDateRange(filters: DfcReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(subMonths(now, 5));
    const endDate = filters.endDate
      ? new Date(filters.endDate)
      : endOfMonth(now);
    return { startDate, endDate };
  }

  private getDfcDateField(filters: DfcReportFilterDto): 'paidDate' | 'dueDate' {
    return filters.regime === 'realizado' ? 'paidDate' : 'dueDate';
  }

  async getDfcSummary(companyId: string, filters: DfcReportFilterDto) {
    const { startDate, endDate } = this.getDfcDateRange(filters);
    const isRealizado = filters.regime === 'realizado';

    // For "realizado", filter by paidDate; for "competencia", filter by dueDate
    const receivableWhere: any = {
      receivable: { companyId, status: { not: 'CANCELED' } },
    };
    const payableWhere: any = {
      payable: { companyId, status: { not: 'CANCELED' } },
    };

    if (isRealizado) {
      receivableWhere.paidDate = { gte: startDate, lte: endDate };
      receivableWhere.status = 'PAID';
      payableWhere.paidDate = { gte: startDate, lte: endDate };
      payableWhere.status = 'PAID';
    } else {
      receivableWhere.dueDate = { gte: startDate, lte: endDate };
      payableWhere.dueDate = { gte: startDate, lte: endDate };
    }

    const receivableInstallments =
      await this.prisma.receivableInstallment.findMany({
        where: receivableWhere,
      });

    const payableInstallments = await this.prisma.payableInstallment.findMany({
      where: payableWhere,
    });

    const totalRevenue = receivableInstallments.reduce(
      (sum, inst) => sum + (inst.paidAmount || inst.amount),
      0,
    );

    const totalExpenses = payableInstallments.reduce(
      (sum, inst) => sum + (inst.paidAmount || inst.amount),
      0,
    );

    return {
      totalRevenue,
      totalExpenses: -totalExpenses,
      finalCashFlow: totalRevenue - totalExpenses,
    };
  }

  async getDfcCashFlowChart(companyId: string, filters: DfcReportFilterDto) {
    const { startDate, endDate } = this.getDfcDateRange(filters);
    const isRealizado = filters.regime === 'realizado';

    const receivableWhere: any = {
      receivable: { companyId, status: { not: 'CANCELED' } },
    };
    const payableWhere: any = {
      payable: { companyId, status: { not: 'CANCELED' } },
    };

    if (isRealizado) {
      receivableWhere.paidDate = { gte: startDate, lte: endDate };
      receivableWhere.status = 'PAID';
      payableWhere.paidDate = { gte: startDate, lte: endDate };
      payableWhere.status = 'PAID';
    } else {
      receivableWhere.dueDate = { gte: startDate, lte: endDate };
      payableWhere.dueDate = { gte: startDate, lte: endDate };
    }

    const receivables = await this.prisma.receivableInstallment.findMany({
      where: receivableWhere,
    });

    const payables = await this.prisma.payableInstallment.findMany({
      where: payableWhere,
    });

    const dateField = isRealizado ? 'paidDate' : 'dueDate';
    const monthlyData: Record<string, { revenue: number; expenses: number }> =
      {};

    receivables.forEach((inst) => {
      const d = inst[dateField] || inst.dueDate;
      const monthKey = format(d, 'yyyy-MM');
      if (!monthlyData[monthKey])
        monthlyData[monthKey] = { revenue: 0, expenses: 0 };
      monthlyData[monthKey].revenue += inst.paidAmount || inst.amount;
    });

    payables.forEach((inst) => {
      const d = inst[dateField] || inst.dueDate;
      const monthKey = format(d, 'yyyy-MM');
      if (!monthlyData[monthKey])
        monthlyData[monthKey] = { revenue: 0, expenses: 0 };
      monthlyData[monthKey].expenses += inst.paidAmount || inst.amount;
    });

    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, data]) => {
        const label = format(new Date(monthKey + '-01'), 'MMM yy', {
          locale: ptBR,
        });
        const net = data.revenue - data.expenses;
        return {
          month: monthKey,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          positive: net > 0 ? net : 0,
          negative: net < 0 ? net : 0,
        };
      });
  }

  async getDfcRevenueExpenseChart(
    companyId: string,
    filters: DfcReportFilterDto,
  ) {
    const { startDate, endDate } = this.getDfcDateRange(filters);
    const isRealizado = filters.regime === 'realizado';

    const receivableWhere: any = {
      receivable: { companyId, status: { not: 'CANCELED' } },
    };
    const payableWhere: any = {
      payable: { companyId, status: { not: 'CANCELED' } },
    };

    if (isRealizado) {
      receivableWhere.paidDate = { gte: startDate, lte: endDate };
      receivableWhere.status = 'PAID';
      payableWhere.paidDate = { gte: startDate, lte: endDate };
      payableWhere.status = 'PAID';
    } else {
      receivableWhere.dueDate = { gte: startDate, lte: endDate };
      payableWhere.dueDate = { gte: startDate, lte: endDate };
    }

    const receivables = await this.prisma.receivableInstallment.findMany({
      where: receivableWhere,
    });

    const payables = await this.prisma.payableInstallment.findMany({
      where: payableWhere,
    });

    const dateField = isRealizado ? 'paidDate' : 'dueDate';
    const monthlyData: Record<string, { revenue: number; expenses: number }> =
      {};

    receivables.forEach((inst) => {
      const d = inst[dateField] || inst.dueDate;
      const monthKey = format(d, 'yyyy-MM');
      if (!monthlyData[monthKey])
        monthlyData[monthKey] = { revenue: 0, expenses: 0 };
      monthlyData[monthKey].revenue += inst.paidAmount || inst.amount;
    });

    payables.forEach((inst) => {
      const d = inst[dateField] || inst.dueDate;
      const monthKey = format(d, 'yyyy-MM');
      if (!monthlyData[monthKey])
        monthlyData[monthKey] = { revenue: 0, expenses: 0 };
      monthlyData[monthKey].expenses += inst.paidAmount || inst.amount;
    });

    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, data]) => {
        const label = format(new Date(monthKey + '-01'), 'MMM yy', {
          locale: ptBR,
        });
        return {
          month: monthKey,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          revenue: data.revenue,
          expenses: data.expenses,
        };
      });
  }

  async getDfcTable(companyId: string, filters: DfcReportFilterDto) {
    const { startDate, endDate } = this.getDfcDateRange(filters);
    const isRealizado = filters.regime === 'realizado';
    const dateField = isRealizado ? 'paidDate' : 'dueDate';

    // Build where clauses
    const receivableWhere: any = {
      companyId,
      status: { not: 'CANCELED' },
    };
    const payableWhere: any = {
      companyId,
      status: { not: 'CANCELED' },
    };

    // We need at least one installment in the date range
    const installmentDateFilter: any = {};
    if (isRealizado) {
      installmentDateFilter.paidDate = { gte: startDate, lte: endDate };
      installmentDateFilter.status = 'PAID';
    } else {
      installmentDateFilter.dueDate = { gte: startDate, lte: endDate };
    }

    // Fetch receivables with nature + subCategory
    const receivables = await this.prisma.receivable.findMany({
      where: {
        ...receivableWhere,
        installments: { some: installmentDateFilter },
      },
      include: {
        nature: true,
        subCategory: true,
        installments: {
          where: installmentDateFilter,
        },
      },
    });

    // Fetch payables with nature + subCategory
    const payables = await this.prisma.payable.findMany({
      where: {
        ...payableWhere,
        installments: { some: installmentDateFilter },
      },
      include: {
        nature: true,
        subCategory: true,
        installments: {
          where: installmentDateFilter,
        },
      },
    });

    // Collect all months in the period
    const months: string[] = [];
    let cursor = startOfMonth(startDate);
    while (cursor <= endDate) {
      months.push(format(cursor, 'yyyy-MM'));
      cursor = startOfMonth(subMonths(cursor, -1));
    }

    const headers = months.map((m) => {
      const label = format(new Date(m + '-01'), 'MMM yy', { locale: ptBR });
      return label.charAt(0).toUpperCase() + label.slice(1);
    });

    // Helper to build monthly values for a set of parent records
    const buildMonthlyValues = (
      records: any[],
      isExpense: boolean,
    ): {
      level1Groups: Record<
        string,
        {
          level2: string;
          natures: Record<
            string,
            {
              natureId: string;
              code: string;
              description: string;
              subCategories: Record<
                string,
                {
                  id: string;
                  code: string;
                  description: string;
                  monthlyValues: Record<string, number>;
                }
              >;
              monthlyValues: Record<string, number>;
            }
          >;
          monthlyValues: Record<string, number>;
        }
      >;
      monthlyTotals: Record<string, number>;
    } => {
      const level1Groups: any = {};
      const monthlyTotals: Record<string, number> = {};
      months.forEach((m) => (monthlyTotals[m] = 0));

      records.forEach((record) => {
        const nature = record.nature;
        const subCategory = record.subCategory;
        const level2Key = nature?.level2 || 'Sem Grupo';
        const natureKey = nature?.id || 'sem-natureza';

        if (!level1Groups[level2Key]) {
          level1Groups[level2Key] = {
            level2: level2Key,
            natures: {},
            monthlyValues: {},
          };
          months.forEach((m) => (level1Groups[level2Key].monthlyValues[m] = 0));
        }

        if (!level1Groups[level2Key].natures[natureKey]) {
          level1Groups[level2Key].natures[natureKey] = {
            natureId: nature?.id || '',
            code: nature?.code || '',
            description: nature?.description || 'Sem Natureza',
            subCategories: {},
            monthlyValues: {},
          };
          months.forEach(
            (m) =>
              (level1Groups[level2Key].natures[natureKey].monthlyValues[m] = 0),
          );
        }

        const subCatKey = subCategory?.id || 'sem-subcategoria';
        if (
          !level1Groups[level2Key].natures[natureKey].subCategories[subCatKey]
        ) {
          level1Groups[level2Key].natures[natureKey].subCategories[subCatKey] =
            {
              id: subCategory?.id || '',
              code: subCategory?.code || '',
              description: subCategory?.description || 'Sem Subcategoria',
              monthlyValues: {},
            };
          months.forEach(
            (m) =>
              (level1Groups[level2Key].natures[natureKey].subCategories[
                subCatKey
              ].monthlyValues[m] = 0),
          );
        }

        // Distribute installment values by month
        record.installments.forEach((inst: any) => {
          const d = inst[dateField] || inst.dueDate;
          const monthKey = format(d, 'yyyy-MM');
          if (!months.includes(monthKey)) return;

          const amount = inst.paidAmount || inst.amount;
          const value = isExpense ? -amount : amount;

          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + value;
          level1Groups[level2Key].monthlyValues[monthKey] += value;
          level1Groups[level2Key].natures[natureKey].monthlyValues[monthKey] +=
            value;
          level1Groups[level2Key].natures[natureKey].subCategories[
            subCatKey
          ].monthlyValues[monthKey] += value;
        });
      });

      return { level1Groups, monthlyTotals };
    };

    // Build revenue tree
    const revenueData = buildMonthlyValues(receivables, false);
    // Build expense tree
    const expenseData = buildMonthlyValues(payables, true);

    // Convert to flat rows
    const rows: any[] = [];

    const toHeaderValues = (monthlyValues: Record<string, number>) => {
      const values: Record<string, number> = {};
      months.forEach((m, i) => {
        values[headers[i]] = monthlyValues[m] || 0;
      });
      return values;
    };

    // Revenue section
    const revenueId = 'receitas';
    rows.push({
      id: revenueId,
      code: '',
      name: 'Receitas',
      level: 0,
      isExpandable: true,
      values: toHeaderValues(revenueData.monthlyTotals),
    });

    Object.entries(revenueData.level1Groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([level2Key, group]) => {
        const groupId = `rec-${level2Key}`;
        rows.push({
          id: groupId,
          code: '',
          name: level2Key,
          level: 1,
          isExpandable: true,
          parentId: revenueId,
          values: toHeaderValues(group.monthlyValues),
        });

        Object.values(group.natures)
          .sort((a: any, b: any) => (a.code || '').localeCompare(b.code || ''))
          .forEach((nature: any) => {
            const natureId = `rec-nat-${nature.natureId}`;
            const hasSubCategories =
              Object.keys(nature.subCategories).length > 0 &&
              !(
                Object.keys(nature.subCategories).length === 1 &&
                Object.keys(nature.subCategories)[0] === 'sem-subcategoria'
              );

            rows.push({
              id: natureId,
              code: nature.code || '',
              name: nature.description,
              level: 2,
              isExpandable: hasSubCategories,
              parentId: groupId,
              values: toHeaderValues(nature.monthlyValues),
            });

            if (hasSubCategories) {
              Object.values(nature.subCategories)
                .sort((a: any, b: any) =>
                  (a.code || '').localeCompare(b.code || ''),
                )
                .forEach((subCat: any) => {
                  rows.push({
                    id: `rec-sub-${subCat.id || subCat.description}`,
                    code: subCat.code || '',
                    name: subCat.description,
                    level: 3,
                    isExpandable: false,
                    parentId: natureId,
                    values: toHeaderValues(subCat.monthlyValues),
                  });
                });
            }
          });
      });

    // Expenses section
    const expenseId = 'despesas';
    rows.push({
      id: expenseId,
      code: '',
      name: 'Despesas',
      level: 0,
      isExpandable: true,
      values: toHeaderValues(expenseData.monthlyTotals),
    });

    Object.entries(expenseData.level1Groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([level2Key, group]) => {
        const groupId = `desp-${level2Key}`;
        rows.push({
          id: groupId,
          code: '',
          name: level2Key,
          level: 1,
          isExpandable: true,
          parentId: expenseId,
          values: toHeaderValues(group.monthlyValues),
        });

        Object.values(group.natures)
          .sort((a: any, b: any) => (a.code || '').localeCompare(b.code || ''))
          .forEach((nature: any) => {
            const natureId = `desp-nat-${nature.natureId}`;
            const hasSubCategories =
              Object.keys(nature.subCategories).length > 0 &&
              !(
                Object.keys(nature.subCategories).length === 1 &&
                Object.keys(nature.subCategories)[0] === 'sem-subcategoria'
              );

            rows.push({
              id: natureId,
              code: nature.code || '',
              name: nature.description,
              level: 2,
              isExpandable: hasSubCategories,
              parentId: groupId,
              values: toHeaderValues(nature.monthlyValues),
            });

            if (hasSubCategories) {
              Object.values(nature.subCategories)
                .sort((a: any, b: any) =>
                  (a.code || '').localeCompare(b.code || ''),
                )
                .forEach((subCat: any) => {
                  rows.push({
                    id: `desp-sub-${subCat.id || subCat.description}`,
                    code: subCat.code || '',
                    name: subCat.description,
                    level: 3,
                    isExpandable: false,
                    parentId: natureId,
                    values: toHeaderValues(subCat.monthlyValues),
                  });
                });
            }
          });
      });

    return { headers, rows };
  }

  async getDfcPdfData(companyId: string, filters: DfcReportFilterDto) {
    const [summary, tableData, company] = await Promise.all([
      this.getDfcSummary(companyId, filters),
      this.getDfcTable(companyId, filters),
      this.prisma.company.findUnique({
        where: { id: companyId },
        include: { address: true },
      }),
    ]);

    const companyAddress = company?.address?.[0];

    return {
      company: {
        name: company?.name,
        cnpj: company?.cnpj,
        logoUrl: company?.logoUrl,
        email: company?.email,
        siteUrl: company?.siteUrl,
        phone: company?.phone,
        address: companyAddress
          ? {
              street: companyAddress.street,
              number: companyAddress.number,
              neighborhood: companyAddress.neighborhood,
              city: companyAddress.city,
              state: companyAddress.state,
            }
          : undefined,
        socialNetworks: {
          instagram: company?.instagram,
          facebook: company?.facebook,
          linkedin: company?.linkedin,
        },
      },
      summary,
      table: tableData,
    };
  }

  // ============== COMMISSION REPORT METHODS ==============

  private getCommissionDateRange(filters: CommissionReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(now);
    const endDate = filters.endDate ? new Date(filters.endDate) : now;
    return { startDate, endDate };
  }

  async getCommissionSummary(
    companyId: string,
    filters: CommissionReportFilterDto,
  ) {
    const { startDate, endDate } = this.getCommissionDateRange(filters);

    const orders = await this.prisma.order.findMany({
      where: {
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        quotation: {
          select: {
            totalValue: true,
            seller: {
              select: {
                sellerProfile: { select: { commission: true } },
              },
            },
            receivable: {
              select: {
                installments: {
                  where: {
                    status: 'PAID',
                    paidDate: { gte: startDate, lte: endDate },
                  },
                  select: { paidAmount: true },
                },
              },
            },
          },
        },
      },
    });

    let salesTotal = 0;
    let salesCount = 0;
    let receivedTotal = 0;
    let receivedCount = 0;
    let commissionTotal = 0;

    orders.forEach((order) => {
      const q = order.quotation;
      const saleValue = q.totalValue || 0;
      const commissionPct = q.seller?.sellerProfile?.commission || 0;

      salesTotal += saleValue;
      salesCount++;

      let orderReceived = 0;
      q.receivable.forEach((rec) => {
        rec.installments.forEach((inst) => {
          const paid = inst.paidAmount || 0;
          orderReceived += paid;
          receivedCount++;
        });
      });
      receivedTotal += orderReceived;

      if (filters.commissionType === 'received_value') {
        commissionTotal += orderReceived * (commissionPct / 100);
      } else {
        commissionTotal += saleValue * (commissionPct / 100);
      }
    });

    return {
      salesTotal,
      salesCount,
      receivedTotal,
      receivedCount,
      commissionTotal,
    };
  }

  async getCommissionTable(
    companyId: string,
    filters: CommissionReportFilterDto,
  ) {
    const { startDate, endDate } = this.getCommissionDateRange(filters);
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const groupBy = filters.groupBy || 'none';

    const orders = await this.prisma.order.findMany({
      where: {
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
        },
      },
      include: {
        quotation: {
          select: {
            id: true,
            description: true,
            totalValue: true,
            approvedAt: true,
            quotationNumber: true,
            client: { select: { id: true, name: true } },
            seller: {
              select: {
                id: true,
                name: true,
                sellerProfile: { select: { commission: true } },
              },
            },
            receivable: {
              select: {
                installments: {
                  where: {
                    status: 'PAID',
                    paidDate: { gte: startDate, lte: endDate },
                  },
                  select: { paidAmount: true, paidDate: true },
                },
              },
            },
          },
        },
      },
    });

    // Build flat records
    const records = orders.map((order) => {
      const q = order.quotation;
      const commissionPct = q.seller?.sellerProfile?.commission || 0;
      let receivedValue = 0;
      let lastPaidDate: Date | null = null;

      q.receivable.forEach((rec) => {
        rec.installments.forEach((inst) => {
          receivedValue += inst.paidAmount || 0;
          if (
            inst.paidDate &&
            (!lastPaidDate || inst.paidDate > lastPaidDate)
          ) {
            lastPaidDate = inst.paidDate;
          }
        });
      });

      return {
        id: q.id,
        clientName: q.client?.name || 'Não informado',
        clientId: q.client?.id || '',
        vendedorId: q.seller?.id || '',
        vendedorName: q.seller?.name || 'Não informado',
        description: `${q.quotationNumber || ''} - ${q.description || 'Sem descrição'}`,
        saleDate: q.approvedAt ? format(q.approvedAt, 'dd/MM/yyyy') : '',
        receivedDate: lastPaidDate ? format(lastPaidDate, 'dd/MM/yyyy') : '',
        saleValue: q.totalValue || 0,
        receivedValue,
        percentage: commissionPct,
      };
    });

    // Sort
    switch (filters.orderBy) {
      case 'saleDate':
        records.sort((a, b) =>
          (a.saleDate || '').localeCompare(b.saleDate || ''),
        );
        break;
      case 'receivedDate':
        records.sort((a, b) =>
          (a.receivedDate || '').localeCompare(b.receivedDate || ''),
        );
        break;
      case 'valueDesc':
        records.sort((a, b) => b.saleValue - a.saleValue);
        break;
      case 'valueAsc':
        records.sort((a, b) => a.saleValue - b.saleValue);
        break;
    }

    const totalCount = records.length;

    if (groupBy !== 'none') {
      let keyFn: (r: (typeof records)[0]) => string;
      let nameFn: (r: (typeof records)[0]) => string;

      if (groupBy === 'vendedor') {
        keyFn = (r) => r.vendedorId || 'unknown';
        nameFn = (r) => r.vendedorName;
      } else if (groupBy === 'saleDate') {
        keyFn = (r) => r.saleDate || 'Sem data';
        nameFn = (r) => r.saleDate || 'Sem data';
      } else {
        keyFn = (r) => r.receivedDate || 'Sem data';
        nameFn = (r) => r.receivedDate || 'Sem data';
      }

      const groupsMap: Record<
        string,
        { id: string; name: string; records: typeof records }
      > = {};

      records.forEach((r) => {
        const key = keyFn(r);
        if (!groupsMap[key]) {
          groupsMap[key] = { id: key, name: nameFn(r), records: [] };
        }
        groupsMap[key].records.push(r);
      });

      const groups = Object.values(groupsMap).map((g) => ({
        vendedorId: g.id,
        vendedorName: g.name,
        count: g.records.length,
        saleTotal: g.records.reduce((sum, r) => sum + r.saleValue, 0),
        receivedTotal: g.records.reduce((sum, r) => sum + r.receivedValue, 0),
        records: g.records,
      }));

      return {
        grouped: true,
        records: [],
        groups,
        totalCount,
        pagination: {
          page,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    }

    // No grouping — paginate
    const paginatedRecords = records.slice((page - 1) * limit, page * limit);

    return {
      grouped: false,
      records: paginatedRecords,
      groups: [],
      totalCount,
      pagination: {
        page,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }
}

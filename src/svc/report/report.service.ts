import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ReportMenuDto } from './dto/menu.dto';
import {
  SalesReportFilterDto,
  SalesReportSummaryResponse,
  SalesEvolutionDataPoint,
  ApprovedRejectedDataPoint,
  OriginChartDataPoint,
  TopProductItem,
  TopClientItem,
  SalesTableDataResponse,
  SaleRecordItem,
  SalesClientGroup,
  SalePhase,
} from './dto/sales-report.dto';
import { QuotationService } from '../../core/sale/quotation/quotation.service';
import { OrderService } from '../../core/sale/order/order.service';
import { PayableService } from '../../core/financial/payable/payable.service';
import { ReceivableService } from '../../core/financial/receivable/receivable.service';
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  differenceInHours,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Origin colors for chart
const ORIGIN_COLORS: Record<string, string> = {
  WhatsApp: '#039855',
  Balcão: '#F97066',
  Instagram: '#475467',
  Site: '#F79009',
  Outros: '#FDB022',
};

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotationService: QuotationService,
    private readonly orderService: OrderService,
    private readonly payableService: PayableService,
    private readonly receivableService: ReceivableService,
  ) {}

  async menu(): Promise<ReportMenuDto> {
    const quotations = await this.quotationService.count();
    const orders = await this.orderService.count();
    const payable = await this.payableService.count();
    const receivable = await this.receivableService.count();
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

  async getSalesReportSummary(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<SalesReportSummaryResponse> {
    const { startDate, endDate } = this.getDateRange(filters);

    // Approved orders (approved quotations)
    const approvedOrders = await this.prisma.order.findMany({
      where: {
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
            totalValue: true,
            approvedAt: true,
            createdAt: true,
            quotationPayment: {
              select: { commission: { select: { totalCommission: true } } },
            },
          },
        },
      },
    });

    const approvedTotal = approvedOrders.reduce(
      (sum, o) => sum + (o.quotation.totalValue || 0),
      0,
    );
    const approvedCount = approvedOrders.length;

    // Commission total
    const commission = approvedOrders.reduce((sum, o) => {
      const comm =
        o.quotation.quotationPayment?.commission?.totalCommission || 0;
      return sum + comm;
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
      select: { totalValue: true },
    });

    const rejectedTotal = rejectedQuotations.reduce(
      (sum, q) => sum + (q.totalValue || 0),
      0,
    );
    const rejectedCount = rejectedQuotations.length;

    // No response (overdue/expired quotations)
    const noResponseQuotations = await this.prisma.quotation.count({
      where: {
        companyId,
        status: 'DONE',
        dueDate: { lt: new Date() },
        approvedAt: null,
        createdAt: { gte: startDate, lte: endDate },
        ...(filters.sellerId && { sellerId: filters.sellerId }),
        ...(filters.originId && { contactSourceId: filters.originId }),
      },
    });

    // Average ticket
    const averageTicket = approvedCount > 0 ? approvedTotal / approvedCount : 0;

    return {
      approvedTotal,
      approvedCount,
      rejectedTotal,
      rejectedCount,
      noResponseTotal: noResponseQuotations,
      averageTicket,
      commission,
      approvalTime,
    };
  }

  async getSalesEvolution(
    companyId: string,
    filters: SalesReportFilterDto,
  ): Promise<SalesEvolutionDataPoint[]> {
    const { startDate, endDate } = this.getDateRange(filters);

    const orders = await this.prisma.order.findMany({
      where: {
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
          ...(filters.originId && { contactSourceId: filters.originId }),
        },
      },
      include: {
        quotation: {
          select: { totalValue: true, approvedAt: true },
        },
      },
    });

    // Group by month
    const monthlyData: Record<
      string,
      { approved: number; inProgress: number }
    > = {};

    orders.forEach((order) => {
      if (order.quotation.approvedAt) {
        const month = format(order.quotation.approvedAt, 'MM');
        if (!monthlyData[month]) {
          monthlyData[month] = { approved: 0, inProgress: 0 };
        }
        if (order.status === 'FINISHED' || order.status === 'COMPLETED') {
          monthlyData[month].approved += order.quotation.totalValue || 0;
        } else {
          monthlyData[month].inProgress += order.quotation.totalValue || 0;
        }
      }
    });

    // Convert to array - only include months with sales (filter out zero values)
    const result: SalesEvolutionDataPoint[] = Object.entries(monthlyData)
      .filter(([_, data]) => data.approved > 0 || data.inProgress > 0)
      .map(([month, data]) => ({
        month,
        approved: data.approved,
        inProgress: data.inProgress,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return result;
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
        order: { select: { id: true } },
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
        expired: 0,
        rejected: 0,
      };
    }

    quotations.forEach((q) => {
      const month = format(q.createdAt, 'MMM', { locale: ptBR });
      if (!monthlyData[month]) return;

      if (q.order) {
        monthlyData[month].approved++;
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

    return quotationsWithOrigin.map((q) => {
      const name = originMap.get(q.contactSourceId!) || 'Outros';
      return {
        name,
        value: q._count,
        color: ORIGIN_COLORS[name] || ORIGIN_COLORS['Outros'],
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
        quotation: {
          companyId,
          approvedAt: { gte: startDate, lte: endDate },
          contactSourceId: { not: null },
          ...(filters.sellerId && { sellerId: filters.sellerId }),
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

    return originIds.map((id) => {
      const name = originMap.get(id) || 'Outros';
      return {
        name,
        value: originCounts[id],
        color: ORIGIN_COLORS[name] || ORIGIN_COLORS['Outros'],
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
          order: { isNot: null },
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

    // Base where clause
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

    const orders = await this.prisma.order.findMany({
      where: whereClause,
      include: {
        quotation: {
          include: {
            client: { select: { id: true, name: true } },
            series: { select: { code: true } },
          },
        },
      },
      orderBy: orderByClause,
      take: limit,
      skip: (page - 1) * limit,
    });

    // Map to SaleRecordItem
    const mapToRecord = (order: any): SaleRecordItem => {
      const q = order.quotation;
      const phase: SalePhase =
        order.status === 'FINISHED'
          ? 'entregue'
          : order.status === 'IN_PRODUCTION' ||
              order.status === 'COMPLETED' ||
              order.status === 'DELIVERY'
            ? 'em-producao'
            : 'aguardando';

      return {
        id: order.id,
        clientName: q.client?.name || 'Cliente não informado',
        serviceDescription: `${q.series?.code || ''}-${q.quotationNumber || ''} - ${q.description || ''}`,
        approvedDate: q.approvedAt ? format(q.approvedAt, 'dd/MM/yyyy') : null,
        dueDate: q.dueDate ? format(q.dueDate, 'dd/MM/yyyy') : '-',
        value: q.totalValue || 0,
        phase,
        phasePercentage:
          phase === 'entregue' ? 100 : phase === 'em-producao' ? 50 : 0,
      };
    };

    const pagination = {
      page,
      totalPages: Math.ceil(totalCount / limit),
      totalRecords: totalCount,
    };

    if (groupBy === 'client') {
      // Group records by client
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

      const groups: SalesClientGroup[] = Object.values(recordsByClient).map(
        (g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
          records: g.records,
        }),
      );

      return { grouped: true, groups, totalCount, pagination };
    } else {
      const records = orders.map(mapToRecord);
      return { grouped: false, records, totalCount, pagination };
    }
  }
}

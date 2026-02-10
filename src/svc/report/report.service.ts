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
import { FinancialReportFilterDto } from './dto/financial-report.dto';
import { CashFlowReportFilterDto } from './dto/cash-flow-report.dto';
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
        totalValue > 0 ? Math.round((value / totalValue) * 100) : 0;

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
      percentage: totalValue > 0 ? Math.round((g.total / totalValue) * 100) : 0,
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
            sector: {
              select: {
                id: true,
                name: true,
                icon: true,
              },
            },
          },
        },
      },
    });

    // Aggregate by sector
    const sectorTotals: Record<
      string,
      { id: string; name: string; icon: string; value: number }
    > = {};

    let generalTotal = 0;

    orderProducts.forEach((qp) => {
      const value = qp.finalValue ?? qp.totalValue ?? 0;
      generalTotal += value;

      const sector = qp.product?.sector;
      if (!sector) return;

      if (!sectorTotals[sector.id]) {
        sectorTotals[sector.id] = {
          id: sector.id,
          name: sector.name,
          icon: sector.icon || '',
          value: 0,
        };
      }
      sectorTotals[sector.id].value += value;
    });

    const sectors = Object.values(sectorTotals).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return { sectors, generalTotal };
  }

  // ============== FINANCIAL REPORT METHODS ==============

  private getFinancialDateRange(filters: FinancialReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(subMonths(now, 5));
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
          dueDate: { gte: startDate, lte: endDate },
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
        switch (status) {
          case 'received':
            result.received += amount;
            result.receivedCount++;
            break;
          case 'confirmed':
            result.confirmed += amount;
            result.confirmedCount++;
            break;
          case 'overdue':
            result.overdue += amount;
            result.overdueCount++;
            break;
          default:
            result.toReceive += amount;
            result.toReceiveCount++;
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
          dueDate: { gte: startDate, lte: endDate },
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
        switch (status) {
          case 'received':
            result.received += amount;
            result.receivedCount++;
            break;
          case 'confirmed':
            result.confirmed += amount;
            result.confirmedCount++;
            break;
          case 'overdue':
            result.overdue += amount;
            result.overdueCount++;
            break;
          default:
            result.toReceive += amount;
            result.toReceiveCount++;
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
            dueDate: { gte: startDate, lte: endDate },
          },
        })
      : await this.prisma.payableInstallment.findMany({
          where: {
            payable: { companyId, status: { not: 'CANCELED' } },
            dueDate: { gte: startDate, lte: endDate },
          },
        });

    // Group by month
    const monthlyData: Record<
      string,
      {
        date: string;
        label: string;
        received: number;
        confirmed: number;
        toReceive: number;
        overdue: number;
      }
    > = {};

    installments.forEach((inst: any) => {
      const monthKey = format(inst.dueDate, 'yyyy-MM');
      const label = format(inst.dueDate, 'MMM/yy', { locale: ptBR });

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          date: monthKey,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          received: 0,
          confirmed: 0,
          toReceive: 0,
          overdue: 0,
        };
      }

      const status = this.getInstallmentStatus(inst);
      const amount = inst.paidAmount || inst.amount;
      monthlyData[monthKey][status] += amount;
    });

    return Object.values(monthlyData).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
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

    if (isReceitas) {
      // Build where clause
      const where: any = {
        receivable: {
          companyId,
          status: { not: 'CANCELED' },
        },
        dueDate: { gte: startDate, lte: endDate },
      };

      // Apply status filter at DB level where possible
      if (statusFilter === 'received') {
        where.status = 'PAID';
      } else if (statusFilter === 'confirmed') {
        where.status = 'PROVISIONED';
      } else if (statusFilter === 'overdue') {
        where.status = 'OVERDUE';
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

      // Compute status and filter post-query for statuses that require runtime check
      let records = allInstallments.map((inst) => {
        const computedStatus = this.getInstallmentStatus(inst);
        const totalValue = allInstallments.reduce(
          (sum, i) => sum + (i.paidAmount || i.amount),
          0,
        );
        return {
          id: inst.id,
          clientId: inst.receivable.clientId || '',
          clientName: inst.receivable.client?.name || 'Não informado',
          description: inst.receivable.description || 'Sem descrição',
          receivedDate: inst.paidDate
            ? format(inst.paidDate, 'dd/MM/yyyy')
            : null,
          value: inst.paidAmount || inst.amount,
          percentage:
            totalValue > 0
              ? Math.round(
                  ((inst.paidAmount || inst.amount) / totalValue) * 100,
                )
              : 0,
          status: computedStatus,
        };
      });

      // Post-filter for to_receive (PENDING status but not overdue)
      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      } else if (
        statusFilter !== 'all' &&
        statusFilter !== 'received' &&
        statusFilter !== 'confirmed' &&
        statusFilter !== 'overdue'
      ) {
        records = records.filter((r) => r.status === statusFilter);
      }

      // Apply client name ordering if needed
      if (filters.orderBy === 'clientName') {
        records.sort((a, b) => a.clientName.localeCompare(b.clientName));
      }

      const totalCount = records.length;

      // Paginate if not grouped
      if (groupBy === 'client') {
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

        const groups = Object.values(groupsMap).map((g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
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
            totalRecords: totalCount,
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
        dueDate: { gte: startDate, lte: endDate },
      };

      if (statusFilter === 'received') {
        where.status = 'PAID';
      } else if (statusFilter === 'confirmed') {
        where.status = 'PROVISIONED';
      } else if (statusFilter === 'overdue') {
        where.status = 'OVERDUE';
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

      let records = allInstallments.map((inst) => {
        const computedStatus = this.getInstallmentStatus(inst);
        const totalValue = allInstallments.reduce(
          (sum, i) => sum + (i.paidAmount || i.amount),
          0,
        );
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
          receivedDate: inst.paidDate
            ? format(inst.paidDate, 'dd/MM/yyyy')
            : null,
          value: inst.paidAmount || inst.amount,
          percentage:
            totalValue > 0
              ? Math.round(
                  ((inst.paidAmount || inst.amount) / totalValue) * 100,
                )
              : 0,
          status: computedStatus,
        };
      });

      if (statusFilter === 'to_receive') {
        records = records.filter((r) => r.status === 'to_receive');
      }

      if (filters.orderBy === 'clientName') {
        records.sort((a, b) => a.clientName.localeCompare(b.clientName));
      }

      const totalCount = records.length;

      if (groupBy === 'client') {
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

        const groups = Object.values(groupsMap).map((g) => ({
          clientId: g.clientId,
          clientName: g.clientName,
          count: g.records.length,
          total: g.records.reduce((sum, r) => sum + r.value, 0),
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
            totalRecords: totalCount,
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

  // ============== CASH FLOW REPORT METHODS ==============

  private getCashFlowDateRange(filters: CashFlowReportFilterDto) {
    const now = new Date();
    const startDate = filters.startDate
      ? new Date(filters.startDate)
      : startOfMonth(now);
    const endDate = filters.endDate
      ? new Date(filters.endDate)
      : endOfMonth(now);
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
    let allRecords: Array<{
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
          ? Math.round((Math.abs(r.value) / totalAbsValue) * 100)
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

      const groups = Object.values(groupsMap).map((g) => ({
        date: g.date,
        count: g.records.length,
        total: g.records.reduce((sum, r) => sum + r.value, 0),
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
          totalRecords: totalCount,
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

      const groups = Object.values(groupsMap).map((g) => ({
        date: '',
        clientId: g.clientId,
        clientName: g.clientName,
        count: g.records.length,
        total: g.records.reduce((sum, r) => sum + r.value, 0),
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
          totalRecords: totalCount,
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
}

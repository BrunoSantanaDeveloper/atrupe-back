import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../../core/auth/guards/jwt.guard';
import { AbacService } from '../../core/auth/abac/abac.service';
import { SalesReportFilterDto } from './dto/sales-report.dto';
import { FinancialReportFilterDto } from './dto/financial-report.dto';
import { CashFlowReportFilterDto } from './dto/cash-flow-report.dto';
import { DfcReportFilterDto } from './dto/dfc-report.dto';
import { CommissionReportFilterDto } from './dto/commission-report.dto';
import { Request } from 'express';

const RESOURCE = 'report';

@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly abacService: AbacService,
  ) {}

  // Helper: enforce seller permission on sales endpoints
  private async enforceSalesPermission(
    req: any,
    filters: SalesReportFilterDto,
  ) {
    const canSeeOtherSellers = await this.abacService.hasPermission(
      { userId: req.user.userId, username: req.user.username },
      'view',
      'sale:other_quotation',
    );

    if (!canSeeOtherSellers && !req.user.isAdmin && req.user.employeeId) {
      filters.sellerId = req.user.employeeId;
    }
  }

  @Get('menu')
  findAll() {
    return this.reportService.menu();
  }

  // ============== FINANCIAL REPORT ENDPOINTS ==============

  @Get('financial/summary')
  async getFinancialSummary(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialSummary(companyId, filters);
  }

  @Get('financial/chart')
  async getFinancialChart(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialChart(companyId, filters);
  }

  @Get('financial/table')
  async getFinancialTable(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialTable(companyId, filters);
  }

  // ============== SALES REPORT ENDPOINTS ==============

  @Get('sales/permissions')
  async getSalesPermissions(@Req() req: Request) {
    const user = (req as any).user;
    const canSeeOtherSellers = await this.abacService.hasPermission(
      { userId: user.userId, username: user.username },
      'view',
      'sale:other_quotation',
    );
    return { canSeeOtherSellers };
  }

  @Get('sales/summary')
  async getSalesSummary(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesReportSummary(companyId, filters);
  }

  @Get('sales/evolution')
  async getSalesEvolution(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesEvolution(companyId, filters);
  }

  @Get('sales/approved-rejected')
  async getApprovedRejected(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getApprovedRejected(companyId, filters);
  }

  @Get('sales/quotations-origin')
  async getQuotationsOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getQuotationsOrigin(companyId, filters);
  }

  @Get('sales/orders-origin')
  async getOrdersOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getOrdersOrigin(companyId, filters);
  }

  @Get('sales/top-products')
  async getTopProducts(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getTopProducts(companyId, filters);
  }

  @Get('sales/top-clients')
  async getTopClients(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getTopClients(companyId, filters);
  }

  @Get('sales/table')
  async getSalesTable(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesTableData(companyId, filters);
  }

  @Get('sales/pdf-data')
  async getSalesPdfData(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesReportPdfData(companyId, filters);
  }

  // ============== CASH FLOW REPORT ENDPOINTS ==============

  @Get('cash-flow/summary')
  async getCashFlowSummary(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowSummary(companyId, filters);
  }

  @Get('cash-flow/chart')
  async getCashFlowChart(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowChart(companyId, filters);
  }

  @Get('cash-flow/table')
  async getCashFlowTable(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowTable(companyId, filters);
  }

  // ============== SECTOR REPORT ==============

  @Get('sector-results')
  async getSectorResults(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSectorResults(companyId, filters);
  }

  // ============== DFC REPORT ENDPOINTS ==============

  @Get('dfc/summary')
  async getDfcSummary(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcSummary(companyId, filters);
  }

  @Get('dfc/cash-flow-chart')
  async getDfcCashFlowChart(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcCashFlowChart(companyId, filters);
  }

  @Get('dfc/revenue-expense-chart')
  async getDfcRevenueExpenseChart(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcRevenueExpenseChart(companyId, filters);
  }

  @Get('dfc/table')
  async getDfcTable(@Query() filters: DfcReportFilterDto, @Req() req: Request) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcTable(companyId, filters);
  }

  // ============== COMMISSION REPORT ENDPOINTS ==============

  @Get('commission/summary')
  async getCommissionSummary(
    @Query() filters: CommissionReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCommissionSummary(companyId, filters);
  }

  @Get('commission/table')
  async getCommissionTable(
    @Query() filters: CommissionReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCommissionTable(companyId, filters);
  }
}

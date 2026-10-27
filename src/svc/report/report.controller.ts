import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../../core/auth/guards/jwt.guard';
import { PermissionsGuard } from '../../core/auth/abac/permissions.guard';
import {
  MoneyFields,
  ValuesOnly,
} from '../../core/auth/abac/money-fields.decorator';
import { DASHBOARD_SALES_MONEY_FIELDS } from '../../core/auth/abac/money-fields';
import { HasAnyPermission } from '../../core/auth/abac/has-any-permission.decorator';
import {
  BlockLevelGuard,
  RequireUnblocked,
} from '../../core/auth/guards/block-level.guard';
import { AbacService } from '../../core/auth/abac/abac.service';
import { SalesReportFilterDto } from './dto/sales-report.dto';
import {
  FinancialReportFilterDto,
  AdvancedFinancialReportFilterDto,
} from './dto/financial-report.dto';
import { CashFlowReportFilterDto } from './dto/cash-flow-report.dto';
import { DfcReportFilterDto } from './dto/dfc-report.dto';
import { CommissionReportFilterDto } from './dto/commission-report.dto';
import { Request } from 'express';

const RESOURCE = 'report';

@UseGuards(JwtAuthGuard, PermissionsGuard, BlockLevelGuard)
// Relatório é valor: sem values:values:view a rota é recusada (por
// enquanto só observa, ver ValuesVisibilityInterceptor). O menu e as
// permissões da sessão ficam de fora
@ValuesOnly()
@Controller(RESOURCE)
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly abacService: AbacService,
  ) {}

  // Helper: enforce seller permission on sales endpoints. Quem não vê
  // outros vendedores tem o filtro de vendedor fixado em si mesmo.
  private async enforceSalesPermission(
    req: any,
    filters: { sellerId?: string },
  ) {
    const canSeeOtherSellers = await this.abacService.canAccessOtherSellers(
      req.user,
    );

    if (!canSeeOtherSellers && !req.user.isAdmin && req.user.employeeId) {
      filters.sellerId = req.user.employeeId;
    }
  }

  @Get('menu')
  @ValuesOnly(false)
  findAll(@Req() req: Request) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.menu(companyId);
  }

  // ============== FINANCIAL REPORT ENDPOINTS ==============

  @Get('financial/summary')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:flow' },
    { action: 'view', resource: 'reports:financial' },
    { action: 'view', resource: 'dashboard:financial' },
  )
  async getFinancialSummary(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialSummary(companyId, filters);
  }

  @Get('financial/chart')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:flow' },
    { action: 'view', resource: 'reports:financial' },
    { action: 'view', resource: 'dashboard:financial' },
  )
  async getFinancialChart(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialChart(companyId, filters);
  }

  @Get('financial/table')
  @HasAnyPermission(
    { action: 'view', resource: 'financial:flow' },
    { action: 'view', resource: 'reports:financial' },
  )
  async getFinancialTable(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialTable(companyId, filters);
  }

  @Get('financial/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  @RequireUnblocked()
  async getFinancialPdfData(
    @Query() filters: FinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getFinancialPdfData(companyId, filters);
  }

  @Get('financial/advanced-pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  @RequireUnblocked()
  async getAdvancedFinancialPdfData(
    @Query() filters: AdvancedFinancialReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getAdvancedFinancialPdfData(companyId, filters);
  }

  // ============== SALES REPORT ENDPOINTS ==============

  @Get('sales/permissions')
  @ValuesOnly(false)
  async getSalesPermissions(@Req() req: Request) {
    const user = (req as any).user;
    const canSeeOtherSellers =
      await this.abacService.canAccessOtherSellers(user);
    return { canSeeOtherSellers };
  }

  @Get('sales/summary')
  // Também do painel inicial, que mostra as contagens a quem não vê valores:
  // sem values:values:view saem só os valores
  @MoneyFields(...DASHBOARD_SALES_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'reports:sales' },
    { action: 'view', resource: 'dashboard:sales' },
    { action: 'view', resource: 'dashboard:quotations' },
  )
  async getSalesSummary(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesReportSummary(companyId, filters);
  }

  @Get('sales/evolution')
  // Também do painel inicial, que mostra as contagens a quem não vê valores:
  // sem values:values:view saem só os valores
  @MoneyFields(...DASHBOARD_SALES_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'reports:sales' },
    { action: 'view', resource: 'dashboard:rankings' },
  )
  async getSalesEvolution(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesEvolution(companyId, filters);
  }

  @Get('sales/approved-rejected')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getApprovedRejected(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getApprovedRejected(companyId, filters);
  }

  // Perdas por motivo (24/10/2026): rejeições e cancelamentos do período
  @Get('sales/losses-by-reason')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getLossesByReason(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getLossesByReason(companyId, filters);
  }

  // Conversão por origem e por vendedor (CRM-6, 27/10/2026)
  @Get('sales/conversion')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getConversion(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getConversion(companyId, filters);
  }

  // Clientes sem compra há N dias (CRM-4, 27/10/2026)
  @Get('sales/inactive-clients')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getInactiveClients(@Query('days') days: string, @Req() req: Request) {
    const companyId = (req as any).user?.companyId;
    const filters: { sellerId?: string } = {};
    await this.enforceSalesPermission(req, filters);
    const n = Math.min(730, Math.max(7, Number(days) || 90));
    return this.reportService.getInactiveClients(
      companyId,
      n,
      filters.sellerId,
    );
  }

  @Get('sales/quotations-origin')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getQuotationsOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getQuotationsOrigin(companyId, filters);
  }

  @Get('sales/orders-origin')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getOrdersOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getOrdersOrigin(companyId, filters);
  }

  @Get('sales/top-products')
  // Também do painel inicial, que mostra as contagens a quem não vê valores:
  // sem values:values:view saem só os valores
  @MoneyFields(...DASHBOARD_SALES_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'reports:sales' },
    { action: 'view', resource: 'dashboard:rankings' },
  )
  async getTopProducts(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getTopProducts(companyId, filters);
  }

  @Get('sales/top-clients')
  // Também do painel inicial, que mostra as contagens a quem não vê valores:
  // sem values:values:view saem só os valores
  @MoneyFields(...DASHBOARD_SALES_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'reports:sales' },
    { action: 'view', resource: 'dashboard:rankings' },
  )
  async getTopClients(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getTopClients(companyId, filters);
  }

  @Get('sales/by-seller')
  // Também do painel inicial, que mostra as contagens a quem não vê valores:
  // sem values:values:view saem só os valores
  @MoneyFields(...DASHBOARD_SALES_MONEY_FIELDS)
  @HasAnyPermission(
    { action: 'view', resource: 'reports:sales' },
    { action: 'view', resource: 'dashboard:rankings' },
  )
  async getSalesBySeller(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesBySeller(companyId, filters);
  }

  @Get('sales/table')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getSalesTable(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getSalesTableData(companyId, filters);
  }

  @Get('sales/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  @RequireUnblocked()
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
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  async getCashFlowSummary(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowSummary(companyId, filters);
  }

  @Get('cash-flow/chart')
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  async getCashFlowChart(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowChart(companyId, filters);
  }

  @Get('cash-flow/table')
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  async getCashFlowTable(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowTable(companyId, filters);
  }

  @Get('cash-flow/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:financial' })
  @RequireUnblocked()
  async getCashFlowPdfData(
    @Query() filters: CashFlowReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getCashFlowPdfData(companyId, filters);
  }

  // ============== SECTOR REPORT ==============

  @Get('sector-results')
  @HasAnyPermission({ action: 'view', resource: 'reports:sector_result' })
  async getSectorResults(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSectorResults(companyId, filters);
  }

  @Get('sector-results/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:sector_result' })
  @RequireUnblocked()
  async getSectorResultsPdfData(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSectorResultsPdfData(companyId, filters);
  }

  // ============== DFC REPORT ENDPOINTS ==============

  @Get('dfc/summary')
  @HasAnyPermission({ action: 'view', resource: 'reports:dfc' })
  async getDfcSummary(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcSummary(companyId, filters);
  }

  @Get('dfc/cash-flow-chart')
  @HasAnyPermission({ action: 'view', resource: 'reports:dfc' })
  async getDfcCashFlowChart(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcCashFlowChart(companyId, filters);
  }

  @Get('dfc/revenue-expense-chart')
  @HasAnyPermission({ action: 'view', resource: 'reports:dfc' })
  async getDfcRevenueExpenseChart(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcRevenueExpenseChart(companyId, filters);
  }

  @Get('dfc/table')
  @HasAnyPermission({ action: 'view', resource: 'reports:dfc' })
  async getDfcTable(@Query() filters: DfcReportFilterDto, @Req() req: Request) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcTable(companyId, filters);
  }

  @Get('dfc/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:dfc' })
  @RequireUnblocked()
  async getDfcPdfData(
    @Query() filters: DfcReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getDfcPdfData(companyId, filters);
  }

  // ============== COMMISSION REPORT ENDPOINTS ==============

  @Get('commission/summary')
  @HasAnyPermission({ action: 'view', resource: 'reports:commission' })
  async getCommissionSummary(
    @Query() filters: CommissionReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    // Comissão de outro vendedor exige ver outros vendedores (EC-25)
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getCommissionSummary(companyId, filters);
  }

  @Get('commission/table')
  @HasAnyPermission({ action: 'view', resource: 'reports:commission' })
  async getCommissionTable(
    @Query() filters: CommissionReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    // Comissão de outro vendedor exige ver outros vendedores (EC-25)
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getCommissionTable(companyId, filters);
  }

  // ============== PRODUCTS SOLD REPORT ==============
  // Usa a permissão do relatório de vendas: é a mesma base de dados e assim
  // quem já vê vendas passa a ver produtos sem configurar cargo.

  @Get('products-sold')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  async getProductsSold(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getProductsSold(companyId, filters);
  }

  @Get('products-sold/pdf-data')
  @HasAnyPermission({ action: 'view', resource: 'reports:sales' })
  @RequireUnblocked()
  async getProductsSoldPdfData(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    await this.enforceSalesPermission(req, filters);
    return this.reportService.getProductsSoldPdfData(companyId, filters);
  }
}

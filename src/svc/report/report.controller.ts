import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../../core/auth/guards/jwt.guard';
import { SalesReportFilterDto } from './dto/sales-report.dto';
import { Request } from 'express';

const RESOURCE = 'report';

@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('menu')
  findAll() {
    return this.reportService.menu();
  }

  // ============== SALES REPORT ENDPOINTS ==============

  @Get('sales/summary')
  async getSalesSummary(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSalesReportSummary(companyId, filters);
  }

  @Get('sales/evolution')
  async getSalesEvolution(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSalesEvolution(companyId, filters);
  }

  @Get('sales/approved-rejected')
  async getApprovedRejected(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getApprovedRejected(companyId, filters);
  }

  @Get('sales/quotations-origin')
  async getQuotationsOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getQuotationsOrigin(companyId, filters);
  }

  @Get('sales/orders-origin')
  async getOrdersOrigin(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getOrdersOrigin(companyId, filters);
  }

  @Get('sales/top-products')
  async getTopProducts(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getTopProducts(companyId, filters);
  }

  @Get('sales/top-clients')
  async getTopClients(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getTopClients(companyId, filters);
  }

  @Get('sales/table')
  async getSalesTable(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSalesTableData(companyId, filters);
  }

  @Get('sales/pdf-data')
  async getSalesPdfData(
    @Query() filters: SalesReportFilterDto,
    @Req() req: Request,
  ) {
    const companyId = (req as any).user?.companyId;
    return this.reportService.getSalesReportPdfData(companyId, filters);
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
}

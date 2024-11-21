import { Controller, Get, UseGuards } from '@nestjs/common';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../../core/auth/guards/jwt.guard';

const RESOURCE = 'report';
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('menu')
  // @HasPermission(AbacAction.List, RESOURCE)
  findAll() {
    return this.reportService.menu();
  }
}

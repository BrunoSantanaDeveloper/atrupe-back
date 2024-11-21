import { Module } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { SaleModule } from '../../core/sale/sale.module';
import { FinancialModule } from '../../core/financial/financial.module';

@Module({
  imports: [SaleModule, FinancialModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}

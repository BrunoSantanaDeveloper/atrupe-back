import { Module } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { SaleModule } from '../../core/sale/sale.module';
import { FinancialModule } from '../../core/financial/financial.module';
import { AuthModule } from '../../core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [SaleModule, FinancialModule, AuthModule, PrismaModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}

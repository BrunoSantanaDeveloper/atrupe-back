import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PlanControlModule } from '../plan/plan-control.module';
import { PricingModule } from '../pricing/pricing.module';
import { InvoiceEntryController, StockController } from './stock.controller';
import { StockService } from './stock.service';

/** Estoque e entrada de nota (Fase 7.5, FULL). */
@Module({
  imports: [AuthModule, PrismaModule, PlanControlModule, PricingModule],
  controllers: [StockController, InvoiceEntryController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}

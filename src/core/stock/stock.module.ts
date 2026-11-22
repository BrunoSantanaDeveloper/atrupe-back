import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PlanControlModule } from '../plan/plan-control.module';
import { PricingModule } from '../pricing/pricing.module';
import { InvoiceEntryController, StockController } from './stock.controller';
import { StockService } from './stock.service';
import {
  PurchasingController,
  StockLotController,
} from './purchasing/purchasing.controller';
import { PurchasingService } from './purchasing/purchasing.service';
import { StockLotService } from './purchasing/stock-lot.service';

/** Estoque, entrada de nota, compras e lotes (Fase 7.5 e ES-8 a ES-17, FULL). */
@Module({
  imports: [AuthModule, PrismaModule, PlanControlModule, PricingModule],
  controllers: [
    StockController,
    InvoiceEntryController,
    PurchasingController,
    StockLotController,
  ],
  providers: [StockService, PurchasingService, StockLotService],
  exports: [StockService],
})
export class StockModule {}

import { Module } from '@nestjs/common';
import { SeriesModule } from './serie/series.module';
import { QuotationModule } from './quotation/quotation.module';
import { OrderModule } from './order/order.module';
import { StatusModule } from './status/status.module';
import { DeliveryScheduleModule } from './delivery-schedule/delivery-schedule.module';
import { ProductionStageModule } from './production-stage/production-stage.module';

@Module({
  imports: [SeriesModule, QuotationModule, OrderModule, StatusModule, DeliveryScheduleModule, ProductionStageModule],
  exports: [SeriesModule, QuotationModule, OrderModule],
})
export class SaleModule {}

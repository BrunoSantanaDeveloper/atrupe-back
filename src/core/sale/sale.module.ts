import { Module } from '@nestjs/common';
import { SeriesModule } from './serie/series.module';
import { QuotationModule } from './quotation/quotation.module';
import { OrderModule } from './order/order.module';
import { StatusModule } from './status/status.module';
import { DeliveryScheduleModule } from './delivery-schedule/delivery-schedule.module';
import { ProductionStageModule } from './production-stage/production-stage.module';
import { SaleHistoryModule } from './sale-history/sale-history.module';
import { ContactSourceModule } from './contact-source/contact-source.module';
import { SalesSettingsModule } from './sales-settings/sales-settings.module';

@Module({
  imports: [
    SeriesModule,
    QuotationModule,
    OrderModule,
    StatusModule,
    DeliveryScheduleModule,
    ProductionStageModule,
    SaleHistoryModule,
    ContactSourceModule,
    SalesSettingsModule,
  ],
  exports: [SeriesModule, QuotationModule, OrderModule],
})
export class SaleModule {}

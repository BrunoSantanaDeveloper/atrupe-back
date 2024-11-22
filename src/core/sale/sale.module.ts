import { Module } from '@nestjs/common';
import { SeriesModule } from './serie/series.module';
import { QuotationModule } from './quotation/quotation.module';
import { OrderModule } from './order/order.module';
import { StatusModule } from './status/status.module';

@Module({
  imports: [SeriesModule, QuotationModule, OrderModule, StatusModule],
  exports: [SeriesModule, QuotationModule, OrderModule],
})
export class SaleModule {}

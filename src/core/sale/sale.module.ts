import { Module } from '@nestjs/common';
import { SeriesModule } from './serie/series.module';
import { QuotationModule } from './quotation/quotation.module';
import { OrderModule } from './order/order.module';

@Module({
  imports: [SeriesModule, QuotationModule, OrderModule],
  exports: [SeriesModule, QuotationModule, OrderModule],
})
export class SaleModule {}

import { Module } from '@nestjs/common';
import { InvoicyModule } from './invoicy/invoicy.module';
import { NfeModule } from './nfe/nfe.module';
import { ProductFiscalModule } from './product-fiscal/product-fiscal.module';

@Module({
  imports: [InvoicyModule, NfeModule, ProductFiscalModule],
  exports: [InvoicyModule, NfeModule, ProductFiscalModule],
})
export class FiscalModule {}

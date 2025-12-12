import { Module } from '@nestjs/common';
import { NfeModule } from './nfe/nfe.module';
import { FiscalConfigModule } from './config/fiscal-config.module';
import { ProductFiscalModule } from './product/product-fiscal.module';

@Module({
  imports: [NfeModule, FiscalConfigModule, ProductFiscalModule],
  exports: [NfeModule, FiscalConfigModule, ProductFiscalModule],
})
export class FiscalModule {}

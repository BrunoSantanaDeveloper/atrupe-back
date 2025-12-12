import { Module } from '@nestjs/common';
import { ProductFiscalService } from './product-fiscal.service';
import { ProductFiscalController } from './product-fiscal.controller';

@Module({
  controllers: [ProductFiscalController],
  providers: [ProductFiscalService],
  exports: [ProductFiscalService],
})
export class ProductFiscalModule {}

import { Module } from '@nestjs/common';
import { ProductFiscalService } from './product-fiscal.service';
import { ProductFiscalController } from './product-fiscal.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [ProductFiscalController],
  providers: [ProductFiscalService],
  exports: [ProductFiscalService],
})
export class ProductFiscalModule {}

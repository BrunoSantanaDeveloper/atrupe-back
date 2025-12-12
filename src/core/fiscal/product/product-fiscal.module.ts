import { Module } from '@nestjs/common';
import { ProductFiscalService } from './product-fiscal.service';
import { ProductFiscalController } from './product-fiscal.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProductFiscalController],
  providers: [ProductFiscalService],
  exports: [ProductFiscalService],
})
export class ProductFiscalModule {}

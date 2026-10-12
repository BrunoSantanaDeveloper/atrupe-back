import { Module, forwardRef } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { ProductFiscalModule } from '../fiscal/product-fiscal/product-fiscal.module';

@Module({
  imports: [AuthModule, PrismaModule, forwardRef(() => ProductFiscalModule)],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { ProductVariationController } from './product-variation.controller';
import { ProductVariationService } from './product-variation.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProductVariationController],
  providers: [ProductVariationService],
})
export class ProductVariationModule {}

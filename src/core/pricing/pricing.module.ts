import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PricingParametersService } from './pricing-parameters.service';

@Module({
  imports: [PrismaModule],
  providers: [PricingParametersService],
  exports: [PricingParametersService],
})
export class PricingModule {}

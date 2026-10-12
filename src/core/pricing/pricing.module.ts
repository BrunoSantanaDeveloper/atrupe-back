import { Module } from '@nestjs/common';
import { PricingParametersService } from './pricing-parameters.service';

@Module({
  providers: [PricingParametersService],
  exports: [PricingParametersService],
})
export class PricingModule {}

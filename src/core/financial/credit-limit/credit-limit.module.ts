import { Module } from '@nestjs/common';
import { CreditLimitService } from './credit-limit.service';
import { CreditLimitController } from './credit-limit.controller';

@Module({
  controllers: [CreditLimitController],
  providers: [CreditLimitService],
})
export class CreditLimitModule {}

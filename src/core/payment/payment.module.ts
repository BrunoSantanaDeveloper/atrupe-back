import { Module } from '@nestjs/common';
import { MethodModule } from './method/method.module';
import { ConditionModule } from './condition/condition.module';

@Module({
  imports: [MethodModule, ConditionModule],
})
export class PaymentModule {}

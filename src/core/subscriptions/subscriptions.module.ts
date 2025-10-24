import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

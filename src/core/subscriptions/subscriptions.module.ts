import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionBlockService } from './subscription-block.service';

@Module({
  imports: [CustomersModule, PrismaModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionBlockService],
  exports: [SubscriptionsService, SubscriptionBlockService],
})
export class SubscriptionsModule {}

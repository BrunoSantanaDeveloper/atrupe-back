import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { CustomersModule } from '../customers/customers.module';
import { SubscriptionBlockService } from './subscription-block.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';

@Module({
  imports: [CustomersModule, PrismaModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionBlockService,
    AsaasGatewayService,
    AdminDashboardService,
    CompanyManagementService,
  ],
  exports: [
    SubscriptionsService,
    SubscriptionBlockService,
    AsaasGatewayService,
    AdminDashboardService,
    CompanyManagementService,
  ],
})
export class SubscriptionsModule {}

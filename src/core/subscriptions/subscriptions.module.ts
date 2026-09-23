import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { CustomersModule } from '../customers/customers.module';
import { CouponsModule } from '../coupons/coupons.module';
import { ContractModule } from '../contract/contract.module';
import { PlanControlModule } from '../plan/plan-control.module';
import { BrasilApiModule } from '../../svc/plug/brasilapi/brasilapi.module';
import { SubscriptionBlockService } from './subscription-block.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';
import { SubscriptionQuoteService } from './pricing/subscription-quote.service';
import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';
import { RegularizationService } from './checkout/regularization.service';
import { CompanyRegistryService } from './checkout/company-registry.service';
import { CompanySessionService } from './checkout/company-session.service';
import { ContractAcceptanceService } from './checkout/contract-acceptance.service';
import { EvolutionService } from './checkout/evolution.service';
import { ComplementsService } from './checkout/complements.service';
import { InstallmentRenewalService } from './installment-renewal.service';

@Module({
  imports: [
    CustomersModule,
    PrismaModule,
    CouponsModule,
    ContractModule,
    PlanControlModule,
    BrasilApiModule,
  ],
  controllers: [SubscriptionsController, CheckoutController],
  providers: [
    SubscriptionsService,
    SubscriptionBlockService,
    AsaasGatewayService,
    AdminDashboardService,
    CompanyManagementService,
    SubscriptionQuoteService,
    CheckoutService,
    RegularizationService,
    CompanyRegistryService,
    CompanySessionService,
    ContractAcceptanceService,
    EvolutionService,
    ComplementsService,
    InstallmentRenewalService,
  ],
  exports: [
    SubscriptionsService,
    SubscriptionBlockService,
    AsaasGatewayService,
    AdminDashboardService,
    CompanyManagementService,
    SubscriptionQuoteService,
    CompanySessionService,
  ],
})
export class SubscriptionsModule {}

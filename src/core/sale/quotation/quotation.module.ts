import { Module } from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PaymentModule } from './payment/payment.module';
import { DeliveryScheduleModule } from '../delivery-schedule/delivery-schedule.module';
import { PlanControlModule } from '../../plan/plan-control.module';
import { AssemblyModule } from '../../assembly/assembly.module';
import { SalesSettingsModule } from '../sales-settings/sales-settings.module';
import { PricingModule } from '../../pricing/pricing.module';
import { ProductionModule } from '../../production/production.module';

// Sub-services
import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationImportService } from './quotation-import.service';
import { QuotationLinesService } from './quotation-lines.service';
import { QuotationResultService } from './quotation-result.service';
import { CreditCheckService } from './credit-check.service';
import { ComposedItemService } from './composed-item.service';
import { QuickSaleService } from '../quick-sale/quick-sale.service';
import { QuickSaleController } from '../quick-sale/quick-sale.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrderModule,
    DeliveryModule,
    PaymentModule,
    DeliveryScheduleModule,
    PlanControlModule,
    // A composição escolhida no item e o retrato da venda (ORC-10)
    AssemblyModule,
    // O markup do terceirizado avulso nas linhas do item (T-4)
    SalesSettingsModule,
    // Tributos da Precificação no resultado previsto (ORC-8)
    PricingModule,
    // O projeto de produção nasce da aprovação (ELITE, Fase 6)
    ProductionModule,
  ],
  // A venda rápida (Fase 7.3) é o mesmo orçamento
  controllers: [QuotationController, QuickSaleController],
  providers: [
    QuotationService,
    QuotationCrudService,
    QuotationItemsService,
    QuotationWorkflowService,
    QuotationFinancialService,
    QuotationPdfService,
    QuotationImportService,
    QuotationLinesService,
    QuotationResultService,
    CreditCheckService,
    // O item montado na hora (ORC-11, Fase 4.5)
    ComposedItemService,
    QuickSaleService,
  ],
  exports: [
    QuotationService,
    QuotationCrudService,
    QuotationItemsService,
    QuotationWorkflowService,
    QuotationFinancialService,
    QuotationPdfService,
    QuotationImportService,
    CreditCheckService,
    QuickSaleService,
  ],
})
export class QuotationModule {}

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
import { FollowUpService } from './follow-up/follow-up.service';
import { FollowUpController } from './follow-up/follow-up.controller';
import { PAYMENT_HOLD_RELEASER } from './payment-hold';

import { OrderRedoController } from './order-redo.controller';
import { OrderRedoService } from './order-redo.service';
import { ProductionStageModule } from '../production-stage/production-stage.module';
import { ProductionMirrorService } from '../../production/production-mirror.service';

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
    // O espelho da agenda (ELITE) depois de refazer a O.S. (GP-51)
    ProductionStageModule,
  ],
  // A venda rápida (Fase 7.3) é o mesmo orçamento
  controllers: [
    QuotationController,
    QuickSaleController,
    FollowUpController,
    OrderRedoController,
  ],
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
    OrderRedoService,
    // Refazer a O.S. conclui tarefas da nova: a agenda do ELITE acompanha.
    // O módulo da produção não exporta o espelho; ele só lê e grava pelo
    // Prisma e pelo recálculo da agenda, então uma instância aqui basta
    ProductionMirrorService,
    // O item montado na hora (ORC-11, Fase 4.5)
    ComposedItemService,
    QuickSaleService,
    // Acompanhamento comercial (CRM fase 2)
    FollowUpService,
    // O financeiro libera a venda pendente pela baixa (PA-6)
    { provide: PAYMENT_HOLD_RELEASER, useExisting: QuotationWorkflowService },
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
    FollowUpService,
  ],
})
export class QuotationModule {}

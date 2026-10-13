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

// Sub-services
import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationImportService } from './quotation-import.service';
import { QuotationLinesService } from './quotation-lines.service';
import { QuotationResultService } from './quotation-result.service';

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
  ],
  controllers: [QuotationController],
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
  ],
  exports: [
    QuotationService,
    QuotationCrudService,
    QuotationItemsService,
    QuotationWorkflowService,
    QuotationFinancialService,
    QuotationPdfService,
    QuotationImportService,
  ],
})
export class QuotationModule {}

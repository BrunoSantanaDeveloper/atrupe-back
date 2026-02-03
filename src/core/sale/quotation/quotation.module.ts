import { Module } from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PaymentModule } from './payment/payment.module';
import { DeliveryScheduleModule } from '../delivery-schedule/delivery-schedule.module';

// Sub-services
import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationImportService } from './quotation-import.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrderModule,
    DeliveryModule,
    PaymentModule,
    DeliveryScheduleModule,
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

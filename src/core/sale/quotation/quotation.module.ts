import { Module } from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { DeliveryModule } from './delivery/delivery.module';
import { PaymentModule } from './payment/payment.module';
import { DeliveryScheduleModule } from '../delivery-schedule/delivery-schedule.module';
import { QuotationHistoryModule } from './history/quotation-history.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrderModule,
    DeliveryModule,
    PaymentModule,
    DeliveryScheduleModule,
    QuotationHistoryModule,
  ],
  controllers: [QuotationController],
  providers: [QuotationService],
  exports: [QuotationService],
})
export class QuotationModule {}

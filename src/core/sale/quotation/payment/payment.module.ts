import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

import { AuthModule } from '../../../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PaymentController],
  providers: [PaymentService],
})
export class PaymentModule {}

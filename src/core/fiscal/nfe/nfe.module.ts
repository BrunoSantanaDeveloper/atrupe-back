import { Module } from '@nestjs/common';
import { NfeService } from './nfe.service';
import { NfeController } from './nfe.controller';
import { InvoicyAuthService } from '../shared/invoicy-auth.service';
import { InvoicyClientService } from '../shared/invoicy-client.service';
import { OrderToInvoicyTransformer } from './transformers/order-to-invoicy.transformer';
import { FiscalConfigModule } from '../config/fiscal-config.module';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule, FiscalConfigModule],
  controllers: [NfeController],
  providers: [
    NfeService,
    InvoicyAuthService,
    InvoicyClientService,
    OrderToInvoicyTransformer,
  ],
  exports: [NfeService],
})
export class NfeModule {}

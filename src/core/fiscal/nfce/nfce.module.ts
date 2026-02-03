import { Module } from '@nestjs/common';
import { NfceController } from './nfce.controller';
import { NfceService } from './nfce.service';
import { NfceContingencySyncService } from './nfce-contingency-sync.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule, InvoicyModule],
  controllers: [NfceController],
  providers: [NfceService, NfceContingencySyncService],
  exports: [NfceService, NfceContingencySyncService],
})
export class NfceModule {}

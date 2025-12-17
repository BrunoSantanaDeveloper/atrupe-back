import { Module } from '@nestjs/common';
import { NfceController } from './nfce.controller';
import { NfceService } from './nfce.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule, InvoicyModule],
  controllers: [NfceController],
  providers: [NfceService],
  exports: [NfceService],
})
export class NfceModule {}

import { Module } from '@nestjs/common';
import { NfceController } from './nfce.controller';
import { NfceService } from './nfce.service';
import { InvoicyModule } from '../invoicy/invoicy.module';

@Module({
  imports: [InvoicyModule],
  controllers: [NfceController],
  providers: [NfceService],
  exports: [NfceService],
})
export class NfceModule {}

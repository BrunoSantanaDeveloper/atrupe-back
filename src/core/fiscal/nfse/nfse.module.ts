import { Module } from '@nestjs/common';
import { NfseController } from './nfse.controller';
import { NfseService } from './nfse.service';
import { InvoicyModule } from '../invoicy/invoicy.module';

@Module({
  imports: [InvoicyModule],
  controllers: [NfseController],
  providers: [NfseService],
  exports: [NfseService],
})
export class NfseModule {}

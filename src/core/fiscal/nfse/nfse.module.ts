import { Module } from '@nestjs/common';
import { NfseController } from './nfse.controller';
import { NfseService } from './nfse.service';
import { NfseBuilderService } from './nfse-builder.service';
import { NfseEventsService } from './nfse-events.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule, InvoicyModule],
  controllers: [NfseController],
  providers: [NfseService, NfseBuilderService, NfseEventsService],
  exports: [NfseService],
})
export class NfseModule {}

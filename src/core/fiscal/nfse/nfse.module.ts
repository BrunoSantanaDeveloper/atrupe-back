import { Module, forwardRef } from '@nestjs/common';
import { NfseController } from './nfse.controller';
import { NfseService } from './nfse.service';
import { NfseBuilderService } from './nfse-builder.service';
import { NfseEventsService } from './nfse-events.service';
import { NfseDraftService } from './nfse-draft.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, InvoicyModule, forwardRef(() => AuthModule)],
  controllers: [NfseController],
  providers: [
    NfseService,
    NfseBuilderService,
    NfseEventsService,
    NfseDraftService,
  ],
  exports: [NfseService, NfseDraftService],
})
export class NfseModule {}

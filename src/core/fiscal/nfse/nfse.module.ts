import { Module, forwardRef } from '@nestjs/common';
import { NfseController } from './nfse.controller';
import { NfseServicosController } from './nfse-servicos.controller';
import { NfseService } from './nfse.service';
import { NfseEventsService } from './nfse-events.service';
import { NfseDraftService } from './nfse-draft.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { MailModule } from '../../mail/mail.module';
import { ProductFiscalModule } from '../product-fiscal/product-fiscal.module';

@Module({
  imports: [
    PrismaModule,
    InvoicyModule,
    MailModule,
    ProductFiscalModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [NfseController, NfseServicosController],
  providers: [NfseService, NfseEventsService, NfseDraftService],
  exports: [NfseService, NfseDraftService],
})
export class NfseModule {}

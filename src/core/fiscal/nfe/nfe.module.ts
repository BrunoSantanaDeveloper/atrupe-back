import { Module, forwardRef } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { NfeService } from './nfe.service';
import { NfeDraftService } from './nfe-draft.service';
import { NfeEventsService } from './nfe-events.service';
import { NfeEmailService } from './nfe-email.service';
import { NfeController } from './nfe.controller';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { ProductFiscalModule } from '../product-fiscal/product-fiscal.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [
    PrismaModule,
    InvoicyModule,
    ProductFiscalModule,
    MailModule,
    // Eventos fiscais custam chamadas pagas ao provedor e seguram conexao do
    // pool: sem teto, um unico tenant consegue degradar todos os outros.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 10,
      },
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [NfeController],
  providers: [NfeService, NfeDraftService, NfeEventsService, NfeEmailService],
  exports: [NfeService],
})
export class NfeModule {}

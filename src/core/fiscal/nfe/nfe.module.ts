import { Module, forwardRef } from '@nestjs/common';
import { NfeService } from './nfe.service';
import { NfeBuilderService } from './nfe-builder.service';
import { NfeDraftService } from './nfe-draft.service';
import { NfeEventsService } from './nfe-events.service';
import { NfeController } from './nfe.controller';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, InvoicyModule, forwardRef(() => AuthModule)],
  controllers: [NfeController],
  providers: [NfeService, NfeBuilderService, NfeDraftService, NfeEventsService],
  exports: [NfeService],
})
export class NfeModule {}

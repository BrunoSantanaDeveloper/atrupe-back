import { Module, forwardRef } from '@nestjs/common';
import { NfceController } from './nfce.controller';
import { NfceService } from './nfce.service';
import { NfceContingencySyncService } from './nfce-contingency-sync.service';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, InvoicyModule, forwardRef(() => AuthModule)],
  controllers: [NfceController],
  providers: [NfceService, NfceContingencySyncService],
  exports: [NfceService, NfceContingencySyncService],
})
export class NfceModule {}

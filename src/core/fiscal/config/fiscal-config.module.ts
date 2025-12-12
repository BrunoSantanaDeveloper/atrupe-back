import { Module } from '@nestjs/common';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalConfigController } from './fiscal-config.controller';
import { InvoicyAuthService } from '../shared/invoicy-auth.service';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FiscalConfigController],
  providers: [FiscalConfigService, InvoicyAuthService],
  exports: [FiscalConfigService, InvoicyAuthService],
})
export class FiscalConfigModule {}

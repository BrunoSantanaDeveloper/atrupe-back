import { Module, forwardRef } from '@nestjs/common';
import { FiscalOnboardingService } from './fiscal-onboarding.service';
import { FiscalOnboardingController } from './fiscal-onboarding.controller';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, InvoicyModule, forwardRef(() => AuthModule)],
  controllers: [FiscalOnboardingController],
  providers: [FiscalOnboardingService],
  exports: [FiscalOnboardingService],
})
export class FiscalOnboardingModule {}

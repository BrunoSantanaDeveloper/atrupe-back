import { Module, forwardRef } from '@nestjs/common';
import { InvoicyService } from './invoicy.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { InvoicyApiService } from './invoicy-api.service';
import { FiscalIssuerReadinessService } from './fiscal-issuer-readiness.service';
import { InvoicyCompanyRegistrationService } from './invoicy-company-registration.service';
import { FiscalIssuerActivationService } from './fiscal-issuer-activation.service';
import { InvoicyController, EmissoresController } from './invoicy.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [InvoicyController, EmissoresController],
  providers: [
    InvoicyService,
    InvoicyHttpService,
    InvoicyApiService,
    FiscalIssuerReadinessService,
    InvoicyCompanyRegistrationService,
    FiscalIssuerActivationService,
  ],
  exports: [
    InvoicyService,
    InvoicyHttpService,
    InvoicyApiService,
    FiscalIssuerReadinessService,
    InvoicyCompanyRegistrationService,
    FiscalIssuerActivationService,
  ],
})
export class InvoicyModule {}

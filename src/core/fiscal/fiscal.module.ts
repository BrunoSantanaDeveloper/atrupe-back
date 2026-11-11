import { Module } from '@nestjs/common';
import { InvoicyModule } from './invoicy/invoicy.module';
import { NfeModule } from './nfe/nfe.module';
import { NfseModule } from './nfse/nfse.module';
import { NfceModule } from './nfce/nfce.module';
import { ProductFiscalModule } from './product-fiscal/product-fiscal.module';
import { CfopModule } from './cfop/cfop.module';
import { OperationNatureModule } from './operation-nature/operation-nature.module';
import { FiscalOnboardingModule } from './onboarding/fiscal-onboarding.module';
import { FiscalSecurityModule } from './shared/fiscal-security.module';
import { FiscalDraftModule } from './drafts/fiscal-draft.module';

@Module({
  imports: [
    FiscalSecurityModule,
    InvoicyModule,
    NfeModule,
    NfseModule,
    NfceModule,
    ProductFiscalModule,
    CfopModule,
    OperationNatureModule,
    FiscalOnboardingModule,
    FiscalDraftModule,
  ],
  exports: [
    FiscalSecurityModule,
    InvoicyModule,
    NfeModule,
    NfseModule,
    NfceModule,
    ProductFiscalModule,
    CfopModule,
    OperationNatureModule,
    FiscalOnboardingModule,
  ],
})
export class FiscalModule {}

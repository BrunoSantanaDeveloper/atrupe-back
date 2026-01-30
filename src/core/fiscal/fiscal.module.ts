import { Module } from '@nestjs/common';
import { InvoicyModule } from './invoicy/invoicy.module';
import { NfeModule } from './nfe/nfe.module';
import { NfseModule } from './nfse/nfse.module';
import { NfceModule } from './nfce/nfce.module';
import { ProductFiscalModule } from './product-fiscal/product-fiscal.module';
import { CfopModule } from './cfop/cfop.module';
import { OperationNatureModule } from './operation-nature/operation-nature.module';

@Module({
  imports: [
    InvoicyModule,
    NfeModule,
    NfseModule,
    NfceModule,
    ProductFiscalModule,
    CfopModule,
    OperationNatureModule,
  ],
  exports: [
    InvoicyModule,
    NfeModule,
    NfseModule,
    NfceModule,
    ProductFiscalModule,
    CfopModule,
    OperationNatureModule,
  ],
})
export class FiscalModule {}

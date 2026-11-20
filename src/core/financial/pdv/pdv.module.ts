import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { PlanControlModule } from '../../plan/plan-control.module';
import { QuotationModule } from '../../sale/quotation/quotation.module';
import { CashControlModule } from '../cash-control/cash-control.module';
import { PdvController } from './pdv.controller';
import { PdvService } from './pdv.service';
import { NfceModule } from '../../fiscal/nfce/nfce.module';

/** A frente de caixa (Fase 7.4): sessão do operador e fila das vendas. */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    PlanControlModule,
    QuotationModule,
    CashControlModule,
    // A NFC-e da venda recebida no caixa (20/11/2026)
    NfceModule,
  ],
  controllers: [PdvController],
  providers: [PdvService],
})
export class PdvModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { PlanControlModule } from '../../plan/plan-control.module';
import { QuotationModule } from '../../sale/quotation/quotation.module';
import { CashControlModule } from '../cash-control/cash-control.module';
import { PdvController } from './pdv.controller';
import { PdvService } from './pdv.service';

/** A frente de caixa (Fase 7.4): sessão do operador e fila das vendas. */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    PlanControlModule,
    QuotationModule,
    CashControlModule,
  ],
  controllers: [PdvController],
  providers: [PdvService],
})
export class PdvModule {}

import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { AccountService } from './account.service';
import { CashControlModule } from '../financial/cash-control/cash-control.module';

@Module({
  // O saldo da conta vem do caixa do dia (Fase 7.1)
  imports: [AuthModule, PrismaModule, CashControlModule],
  controllers: [BankController],
  providers: [BankService, AccountService],
})
export class BankModule {}

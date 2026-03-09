import { Module } from '@nestjs/common';
import { ReceivableService } from './receivable.service';
import { ReceivableController } from './receivable.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { FinancialHistoryModule } from '../history/history.module';
import { BaseTransactionService } from '../utils/base-transaction.service';

@Module({
  imports: [AuthModule, PrismaModule, FinancialHistoryModule],
  controllers: [ReceivableController],
  providers: [ReceivableService, BaseTransactionService],
  exports: [ReceivableService],
})
export class ReceivableModule {}

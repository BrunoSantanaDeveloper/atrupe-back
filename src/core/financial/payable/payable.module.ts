import { Module } from '@nestjs/common';
import { PayableService } from './payable.service';
import { PayableController } from './payable.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { FinancialHistoryModule } from '../history/history.module';
import { BaseTransactionService } from '../utils/base-transaction.service';

@Module({
  imports: [AuthModule, PrismaModule, FinancialHistoryModule],
  controllers: [PayableController],
  providers: [PayableService, BaseTransactionService],
  exports: [PayableService],
})
export class PayableModule {}

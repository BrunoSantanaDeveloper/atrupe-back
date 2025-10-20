import { Module } from '@nestjs/common';
import { FinancialHistoryService } from './history.service';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  providers: [FinancialHistoryService],
  exports: [FinancialHistoryService],
})
export class FinancialHistoryModule {}

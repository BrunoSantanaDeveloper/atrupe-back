import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SaleHistoryController } from './sale-history.controller';
import { SaleHistoryService } from './sale-history.service';

@Module({
  imports: [PrismaModule],
  controllers: [SaleHistoryController],
  providers: [SaleHistoryService],
  exports: [SaleHistoryService],
})
export class SaleHistoryModule {}

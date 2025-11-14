import { Module } from '@nestjs/common';
import { QuotationHistoryService } from './quotation-history.service';
import { QuotationHistoryController } from './quotation-history.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [QuotationHistoryController],
  providers: [QuotationHistoryService],
  exports: [QuotationHistoryService],
})
export class QuotationHistoryModule {}

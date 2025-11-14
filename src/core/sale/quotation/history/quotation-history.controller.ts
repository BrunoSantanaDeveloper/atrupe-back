import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { QuotationHistoryService } from './quotation-history.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt.guard';

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationHistoryController {
  constructor(
    private readonly quotationHistoryService: QuotationHistoryService,
  ) {}

  @Get(':id/history')
  async getQuotationHistory(@Param('id') quotationId: string) {
    return this.quotationHistoryService.getQuotationHistory(quotationId);
  }
}

import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/core/auth/guards/jwt.guard';
import { SaleHistoryService } from './sale-history.service';
import { SaleHistoryResponseDto } from './dto/sale-history-response.dto';

@Controller('sales/history')
@UseGuards(JwtAuthGuard)
export class SaleHistoryController {
  constructor(private readonly saleHistoryService: SaleHistoryService) {}

  /**
   * GET /sales/history/quotation/:quotationId
   * Retorna histórico unificado de uma venda pelo ID do orçamento
   */
  @Get('quotation/:quotationId')
  async getHistoryByQuotation(
    @Param('quotationId') quotationId: string,
    @Req() req,
  ): Promise<SaleHistoryResponseDto> {
    try {
      return await this.saleHistoryService.getSaleHistory(
        quotationId,
        req.user.companyId,
      );
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  /**
   * GET /sales/history/order/:orderId
   * Retorna histórico unificado de uma venda pelo ID da ordem de serviço
   */
  @Get('order/:orderId')
  async getHistoryByOrder(
    @Param('orderId') orderId: string,
    @Req() req,
  ): Promise<SaleHistoryResponseDto> {
    try {
      return await this.saleHistoryService.getSaleHistoryByOrderId(
        orderId,
        req.user.companyId,
      );
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }
}

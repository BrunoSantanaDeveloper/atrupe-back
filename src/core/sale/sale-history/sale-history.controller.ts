import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
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

// Permissão no endpoint em modo observar (Fase 2): a recusa vai para o log
// sem recusar, até a semana de log limpo; handler com
// @ObservePermissions(false) já recusa.
@ObservePermissions()
@Controller('sales/history')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SaleHistoryController {
  constructor(private readonly saleHistoryService: SaleHistoryService) {}

  /**
   * GET /sales/history/quotation/:quotationId
   * Retorna histórico unificado de uma venda pelo ID do orçamento
   */
  @Get('quotation/:quotationId')
  @HasPermission('view', 'sale:quotation')
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
  @HasPermission('view', 'sale:order')
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

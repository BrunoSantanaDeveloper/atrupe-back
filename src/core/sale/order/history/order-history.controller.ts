import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OrderHistoryService } from './order-history.service';
import { JwtAuthGuard } from '../../../auth/guards/jwt.guard';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderHistoryController {
  constructor(private readonly orderHistoryService: OrderHistoryService) {}

  @Get(':id/history')
  async getOrderHistory(@Param('id') orderId: string) {
    return this.orderHistoryService.getOrderHistory(orderId);
  }
}

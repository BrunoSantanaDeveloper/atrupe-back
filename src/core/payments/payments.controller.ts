import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PaymentResponseDto } from './dto/payment-response.dto';

@ApiTags('payments')
@Controller('payments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos os pagamentos da empresa' })
  @ApiResponse({
    status: 200,
    description: 'Lista de pagamentos retornada com sucesso',
    type: [PaymentResponseDto],
  })
  async findAll(@Req() req) {
    return this.paymentsService.findAll(req.user.companyId);
  }

  @Get('subscription/:subscriptionId')
  @ApiOperation({
    summary: 'Listar pagamentos de uma subscription específica',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'ID da subscription',
  })
  @ApiResponse({
    status: 200,
    description: 'Pagamentos da subscription retornados com sucesso',
    type: [PaymentResponseDto],
  })
  @ApiResponse({
    status: 404,
    description: 'Nenhum pagamento encontrado',
  })
  async findBySubscription(@Param('subscriptionId') subscriptionId: string) {
    return this.paymentsService.findBySubscription(subscriptionId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um pagamento específico' })
  @ApiParam({
    name: 'id',
    description: 'ID do payment',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment encontrado com sucesso',
    type: PaymentResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Payment não encontrado',
  })
  async findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Get(':id/status')
  @ApiOperation({
    summary: 'Consultar status atualizado do pagamento no Asaas',
  })
  @ApiParam({
    name: 'id',
    description: 'ID do payment',
  })
  @ApiResponse({
    status: 200,
    description: 'Status atualizado retornado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment não encontrado',
  })
  async getPaymentStatus(@Param('id') id: string) {
    return this.paymentsService.getPaymentStatus(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar um pagamento pendente' })
  @ApiParam({
    name: 'id',
    description: 'ID do payment',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment cancelado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Não é possível cancelar este payment',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment não encontrado',
  })
  async cancelPayment(@Param('id') id: string) {
    return this.paymentsService.cancelPayment(id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Estornar um pagamento confirmado' })
  @ApiParam({
    name: 'id',
    description: 'ID do payment',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment estornado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Apenas pagamentos confirmados podem ser estornados',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment não encontrado',
  })
  async refundPayment(@Param('id') id: string) {
    return this.paymentsService.refundPayment(id);
  }
}

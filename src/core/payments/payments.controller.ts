import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { PaymentResponseDto } from './dto/payment-response.dto';

/**
 * A cobrança é da conta da sessão. O superadmin vê qualquer uma; sem a
 * empresa na sessão, ninguém vê.
 */
function companyOf(user: {
  companyId?: string;
  isSystemAdmin?: boolean;
}): string | undefined {
  if (user?.isSystemAdmin) return undefined;
  if (!user?.companyId) throw new ForbiddenException('Acesso negado.');
  return user.companyId;
}

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
  async findBySubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Req() req,
  ) {
    return this.paymentsService.findBySubscription(
      subscriptionId,
      companyOf(req.user),
    );
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
  async findOne(@Param('id') id: string, @Req() req) {
    return this.paymentsService.findOne(id, companyOf(req.user));
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
  async getPaymentStatus(@Param('id') id: string, @Req() req) {
    return this.paymentsService.getPaymentStatus(id, companyOf(req.user));
  }

  // Cancelar e estornar mexem em dinheiro e não recebem companyId: sem o guard,
  // qualquer usuário autenticado estornava a cobrança de qualquer empresa
  // passando o id — inclusive a própria, pagando e desfazendo em seguida.
  @Post(':id/cancel')
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(SystemAdminGuard)
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

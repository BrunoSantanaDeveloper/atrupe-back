import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { AsaasWebhookPayload } from './dto/asaas-webhook.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';
import { WebhookTokenGuard } from '../auth/guards/webhook-token.guard';

@Controller('webhooks')
@ApiTags('Webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('asaas')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookTokenGuard)
  @ApiOperation({
    summary: 'Receber webhook do Asaas',
    description:
      'Endpoint para receber notificações de eventos do Asaas (pagamentos, assinaturas, etc.)',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook recebido e processado com sucesso',
  })
  @ApiResponse({
    status: 400,
    description: 'Dados inválidos',
  })
  async handleAsaasWebhook(@Body() payload: AsaasWebhookPayload) {
    return this.webhooksService.handleAsaasWebhook(payload);
  }

  @Get('events/unprocessed')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar eventos não processados',
    description:
      'Retorna todos os eventos de webhook que ainda não foram processados',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de eventos não processados',
  })
  async getUnprocessedEvents() {
    return this.webhooksService.getUnprocessedEvents();
  }

  @Post('events/:id/reprocess')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reprocessar evento',
    description: 'Reprocessa um evento de webhook específico',
  })
  @ApiResponse({
    status: 200,
    description: 'Evento reprocessado com sucesso',
  })
  @ApiResponse({
    status: 404,
    description: 'Evento não encontrado',
  })
  async reprocessEvent(@Param('id') id: string) {
    await this.webhooksService.reprocessEvent(id);
    return { message: 'Evento reprocessado com sucesso' };
  }
}

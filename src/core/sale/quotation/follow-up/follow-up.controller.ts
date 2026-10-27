import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasPermission } from 'src/core/auth/abac/has-permission.decorator';
import { HasAnyPermission } from 'src/core/auth/abac/has-any-permission.decorator';
import { PermissionsGuard } from 'src/core/auth/abac/permissions.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt.guard';
import { AbacService } from '../../../auth/abac/abac.service';
import { FollowUpService } from './follow-up.service';
import { FollowUpSettingsDto } from './follow-up.dto';

const UUID = new ParseUUIDPipe({ version: '4' });

/**
 * Acompanhamento comercial (CRM fase 2): totais, configuração e a linha do
 * tempo do cliente. Registrar contato e a linha do tempo do orçamento ficam
 * no QuotationController, que confere o dono do orçamento.
 */
@ApiTags('Acompanhamento comercial')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sale/follow-up')
export class FollowUpController {
  constructor(
    private readonly followUp: FollowUpService,
    private readonly abacService: AbacService,
  ) {}

  private async sellerScope(user: any): Promise<string | undefined> {
    const canSeeOthers = await this.abacService.canAccessOtherSellers(user);
    if (!canSeeOthers && !user.isAdmin && user.employeeId) {
      return user.employeeId;
    }
    return undefined;
  }

  // Os números da aba Aguardando e do contador do menu (CRM-2, CRM-3)
  @Get('summary')
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({
    summary: 'Para retomar, atrasados, vencendo e sem próximo contato',
  })
  async summary(@Req() req) {
    return this.followUp.summary(
      req.user.companyId,
      await this.sellerScope(req.user),
    );
  }

  @Get('settings')
  @HasAnyPermission(
    { action: 'view', resource: 'sales_settings:series' },
    { action: 'view', resource: 'sale:quotation' },
  )
  @ApiOperation({
    summary: 'Modelos de mensagem, e-mail diário e dias sem compra',
  })
  settings(@Req() req) {
    return this.followUp.settings(req.user.companyId);
  }

  @Put('settings')
  @HasPermission('edit', 'sales_settings:series')
  @ApiOperation({ summary: 'Grava a configuração do acompanhamento' })
  saveSettings(@Req() req, @Body() dto: FollowUpSettingsDto) {
    return this.followUp.saveSettings(req.user.companyId, dto);
  }

  // A aba Contatos do cliente (CRM-4)
  @Get('client/:id')
  @HasPermission('view', 'sale:quotation')
  @ApiOperation({ summary: 'Linha do tempo dos contatos do cliente' })
  client(@Req() req, @Param('id', UUID) id: string) {
    return this.followUp.clientTimeline(req.user.companyId, id);
  }
}

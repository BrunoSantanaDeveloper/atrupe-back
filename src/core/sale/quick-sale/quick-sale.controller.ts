import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../../auth/abac/has-any-permission.decorator';
import { ObservePermissions } from '../../auth/abac/observe-permissions.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { QuickSaleService } from './quick-sale.service';
import { QuickSaleSettingsDto } from './dto/quick-sale.dto';

/** A configuração da venda rápida (VR-4, VR-5, FC-17): uma por empresa. */
@ApiTags('Venda rápida')
@UseGuards(JwtAuthGuard, FeatureGuard, PermissionsGuard)
@RequiresFeature('quotation_quick_sale')
@ApiBearerAuth()
// Rotas novas: a permissão já recusa
@ObservePermissions(false)
@Controller('sale/quick-sale')
export class QuickSaleController {
  constructor(private readonly quickSale: QuickSaleService) {}

  // Também a lêem o orçamento (o caminho e as formas) e a frente de caixa
  // (o sinal mínimo)
  @Get('settings')
  @HasAnyPermission(
    { action: 'view', resource: 'sales_settings:series' },
    { action: 'view', resource: 'sale:quotation' },
    { action: 'view', resource: 'financial:pdv' },
  )
  @ApiOperation({ summary: 'A configuração da venda rápida, ou os padrões' })
  settings(@Req() req) {
    return this.quickSale.settings(req.user.companyId);
  }

  @Put('settings')
  @HasPermission('edit', 'sales_settings:series')
  @ApiOperation({ summary: 'Grava a configuração inteira da venda rápida' })
  save(@Req() req, @Body() dto: QuickSaleSettingsDto) {
    return this.quickSale.saveSettings(req.user.companyId, dto);
  }
}

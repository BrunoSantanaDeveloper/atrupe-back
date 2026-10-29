import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { UpdateSalesSettingsDto } from './dto/sales-settings.dto';
import { SalesSettingsService } from './sales-settings.service';

/**
 * Configurações › Vendas › Terceirizado avulso (MS-16, T-4). O painel do
 * orçamento não lê esta rota: a prévia da linha já devolve o markup.
 */
@ApiTags('Configurações de venda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
// Rota por módulo (D35): /sale/settings, no lugar do /sales-settings do contrato
@Controller('sale/settings')
export class SalesSettingsController {
  constructor(private readonly service: SalesSettingsService) {}

  @Get()
  @HasPermission('view', 'sales_settings:series')
  @ApiOperation({ summary: 'As configurações de venda da empresa' })
  get(@Req() req) {
    return this.service.get(req.user.companyId);
  }

  // O terceirizado avulso existe já no START (T-5); a composição também o tem
  @Put()
  @HasPermission('edit', 'sales_settings:series')
  @RequiresFeature(['outsourced_item', 'product_composition'])
  @ApiOperation({ summary: 'Muda o acréscimo sobre o custo do terceirizado' })
  update(@Req() req, @Body() dto: UpdateSalesSettingsDto) {
    return this.service.update(req.user.companyId, dto);
  }
}

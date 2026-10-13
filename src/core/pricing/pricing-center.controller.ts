import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import {
  PermissionsGuard,
  permissionDenied,
} from '../auth/abac/permissions.guard';
import {
  VALUES_PERMISSION,
  canViewValues,
} from '../auth/abac/values-visibility.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import {
  PricingItemFilterDto,
  PricingParametersDto,
  UpdatePricingItemDto,
} from './dto/pricing.dto';
import { PricingCenterService } from './pricing-center.service';

const PRICING = 'cost:pricing';

/**
 * A precificação (módulo 4, PRO). Tela de método (SEG-6): `cost:pricing`, a
 * precificação no plano e, em todas as rotas, ver valores (sem eles, 403).
 * O acesso fica no registro de atividade; as escritas, no histórico de
 * custo (SEG-4).
 */
@ApiTags('Precificação')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('pricing_center')
@Controller('pricing')
export class PricingCenterController {
  constructor(
    private readonly pricing: PricingCenterService,
    private readonly abac: AbacService,
  ) {}

  private async session(req) {
    if (!(await canViewValues(req, this.abac))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return {
      companyId: req.user.companyId as string,
      userId: (req.user.userId as string) ?? null,
    };
  }

  @Get('summary')
  @HasPermission('view', PRICING)
  @ApiOperation({ summary: 'Parâmetros, markup e contagens por grupo' })
  async summary(@Req() req) {
    const { companyId } = await this.session(req);
    return this.pricing.summary(companyId);
  }

  // O modal de preço também abre do cadastro de produtos e de materiais:
  // ali basta poder editar o produto para ler os parâmetros
  @Get('parameters')
  @HasAnyPermission(
    { action: 'view', resource: PRICING },
    { action: 'edit', resource: 'product_settings:products' },
  )
  @ApiOperation({ summary: 'Os parâmetros da precificação' })
  async parameters(@Req() req) {
    const { companyId } = await this.session(req);
    return this.pricing.parametersView(companyId);
  }

  @Put('parameters')
  @HasPermission('edit', PRICING)
  @ApiOperation({ summary: 'Grava os quatro parâmetros da empresa' })
  async updateParameters(@Req() req, @Body() dto: PricingParametersDto) {
    const { companyId, userId } = await this.session(req);
    return this.pricing.updateParameters(companyId, userId, dto);
  }

  @Get('item')
  @HasPermission('view', PRICING)
  @ApiOperation({ summary: 'Itens de um grupo com custo, preço e margem' })
  async items(@Req() req, @Query() filter: PricingItemFilterDto) {
    const { companyId } = await this.session(req);
    return this.pricing.items(companyId, filter);
  }

  @Patch('item/:id')
  @HasPermission('edit', PRICING)
  @ApiOperation({ summary: 'Grava a regra e o preço do item' })
  async updateItem(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdatePricingItemDto,
  ) {
    const { companyId, userId } = await this.session(req);
    return this.pricing.updateItem(companyId, userId, id, dto);
  }
}

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbacService } from '../auth/abac/abac.service';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import {
  canViewValues,
  omitMoneyFields,
} from '../auth/abac/values-visibility.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import { AssemblyResourceService } from './assembly-resource.service';
import { ResourceFilterDto } from './dto/process.dto';

const PRODUCTS = 'product_settings:products';
const RESOURCE_MONEY_FIELDS = new Set(['unitCost', 'unitSale']);

/**
 * Os recursos que uma linha de composição pode usar (CP-3, IP-31), para o
 * produto e para o processo. Plano: `cost_base`. O caminho fica sob
 * `/product` e não colide com `GET /product/:id`, que só aceita UUID.
 */
@ApiTags('Composição')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('cost_base')
@Controller('product')
export class AssemblyResourceController {
  constructor(
    private readonly resources: AssemblyResourceService,
    private readonly pricing: PricingParametersService,
    private readonly abacService: AbacService,
  ) {}

  @Get('assembly-resource')
  @HasPermission('view', PRODUCTS)
  @ApiOperation({ summary: 'Recursos para as linhas da composição' })
  async list(@Req() req, @Query() filter: ResourceFilterDto) {
    const companyId = req.user.companyId;
    const [page, markup, values] = await Promise.all([
      this.resources.list(companyId, filter),
      this.pricing.referenceMarkupOf(companyId),
      canViewValues(req, this.abacService),
    ]);
    // Sem preço de venda próprio, vale custo × markup de referência (IP-25)
    const result = {
      ...page,
      data: page.data.map((resource) => ({
        ...resource,
        unitSale: resource.unitSale ?? resource.unitCost * markup,
      })),
    };
    return values ? result : omitMoneyFields(result, RESOURCE_MONEY_FIELDS);
  }
}

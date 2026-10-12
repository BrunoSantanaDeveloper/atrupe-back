import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AbacService } from '../auth/abac/abac.service';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import {
  PermissionsGuard,
  permissionDenied,
} from '../auth/abac/permissions.guard';
import {
  VALUES_PERMISSION,
  canViewValues,
} from '../auth/abac/values-visibility.interceptor';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import {
  SaveProductVariationsDto,
  UpdateProductVariationDto,
} from './dto/product-variation.dto';
import { PriceTierQueryDto, SavePriceTiersDto } from './dto/price-tier.dto';
import { ProductVariationService } from './product-variation.service';

const PRODUCTS = 'product_settings:products';

// O id que não é UUID responde como o que não existe
const ProductId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Produto não encontrado'),
});
const VariationId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException('Variação não encontrada'),
});

// Quem lê o produto: o cadastro, e o orçamento, que escolhe a variação e
// aplica a faixa no item
const READERS = [
  { action: 'view', resource: PRODUCTS },
  { action: 'create', resource: 'sale:quotation' },
  { action: 'edit', resource: 'sale:quotation' },
];

/**
 * Variações simples do produto (PV-6, START, sem recurso de plano) e preço
 * por faixa de quantidade (FQ-1 a FQ-4, recurso `product_composition`).
 * Contrato da API, módulo 1, parte A.
 *
 * O preço nas leituras segue a regra do `/product` (helper de valores, em
 * modo observar): o orçamento de quem não vê valores ainda aplica o preço da
 * variação e da faixa no item.
 */
@ApiTags('Produtos: variações e faixas de preço')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('product')
export class ProductVariationController {
  constructor(
    private readonly service: ProductVariationService,
    private readonly abacService: AbacService,
  ) {}

  @Get(':id/variation')
  @HasAnyPermission(...READERS)
  @MoneyFields('unitPrice')
  @ApiOperation({ summary: 'Lista as variações do produto' })
  list(@Req() req, @Param('id', ProductId) id: string) {
    return this.service.list(req.user.companyId, id);
  }

  @Put(':id/variation')
  @HasPermission('edit', PRODUCTS)
  @MoneyFields('unitPrice')
  @ApiOperation({ summary: 'Substitui as variações simples: nome e preço' })
  async replace(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: SaveProductVariationsDto,
  ) {
    return this.service.replace(
      req.user.companyId,
      id,
      dto.variations,
      await canViewValues(req, this.abacService),
    );
  }

  @Patch(':id/variation/:variationId')
  @HasPermission('edit', PRODUCTS)
  @MoneyFields('unitPrice')
  @ApiOperation({ summary: 'Renomeia a variação ou muda o preço dela' })
  async update(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('variationId', VariationId) variationId: string,
    @Body() dto: UpdateProductVariationDto,
  ) {
    return this.service.update(
      req.user.companyId,
      id,
      variationId,
      dto,
      await canViewValues(req, this.abacService),
    );
  }

  @Delete(':id/variation/:variationId')
  // Remover a variação de dentro do produto é editar o produto
  @HasPermission('edit', PRODUCTS)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a variação e a tabela dela' })
  async remove(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Param('variationId', VariationId) variationId: string,
  ) {
    await this.service.remove(req.user.companyId, id, variationId);
  }

  @Get(':id/price-tier')
  @UseGuards(FeatureGuard)
  @RequiresFeature('product_composition')
  @HasAnyPermission(...READERS, { action: 'view', resource: 'cost:pricing' })
  @MoneyFields('unitPrice')
  @ApiOperation({ summary: 'Lê a tabela de preço por faixa de quantidade' })
  tiers(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Query() query: PriceTierQueryDto,
  ) {
    return this.service.tiers(req.user.companyId, id, query.variationId);
  }

  @Put(':id/price-tier')
  @UseGuards(FeatureGuard)
  @RequiresFeature('product_composition')
  @HasAnyPermission(
    { action: 'edit', resource: PRODUCTS },
    { action: 'edit', resource: 'cost:pricing' },
  )
  @ApiOperation({
    summary: 'Grava a tabela de preço por faixa do produto ou da variação',
  })
  async saveTiers(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: SavePriceTiersDto,
  ) {
    // A tabela é preço: quem não vê valores não a grava
    if (!(await canViewValues(req, this.abacService))) {
      throw permissionDenied([VALUES_PERMISSION]);
    }
    return this.service.saveTiers(req.user.companyId, id, dto);
  }
}

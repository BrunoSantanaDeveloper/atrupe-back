import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasAnyPermission } from '../auth/abac/has-any-permission.decorator';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RequiresFeature } from '../plan/decorators/requires-feature.decorator';
import { FeatureGuard } from '../plan/guards/feature.guard';
import { SaleCompositionDto, SaleFormQueryDto } from './dto/sale.dto';
import { PRODUCT_NOT_FOUND } from './product-assembly.service';
import { ProductSaleService } from './product-sale.service';

// O id que não é UUID responde como o que não existe
const ProductId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException(PRODUCT_NOT_FOUND),
});

/**
 * O produto na venda (IP-36): a vista do vendedor. Não pede a permissão da
 * composição, só a do orçamento, e nunca devolve custo (ORC-7, SEG-6). Plano:
 * `product_composition`.
 */
@ApiTags('Produto na venda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('product_composition')
@Controller('product')
export class ProductSaleController {
  constructor(private readonly service: ProductSaleService) {}

  @Get(':id/sale-form')
  @HasAnyPermission(
    { action: 'view', resource: 'sale:quotation' },
    { action: 'edit', resource: 'sale:quotation' },
  )
  @ApiOperation({ summary: 'As escolhas do produto no item do orçamento' })
  saleForm(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Query() query: SaleFormQueryDto,
  ) {
    return this.service.saleForm(req.user.companyId, id, query.variationId);
  }

  // Leitura com corpo: não grava nada
  @Post(':id/sale-composition')
  @HasPermission('view', 'sale:quotation')
  @HttpCode(200)
  @ApiOperation({ summary: 'O relatório da composição daquela venda' })
  saleComposition(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: SaleCompositionDto,
  ) {
    return this.service.saleComposition(req.user.companyId, id, dto);
  }
}

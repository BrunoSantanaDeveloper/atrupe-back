import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { PRODUCT_MONEY_FIELDS } from '../auth/abac/money-fields';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { DuplicateProductDto } from './dto/catalog.dto';
import { PRODUCT_NOT_FOUND } from './product-assembly.service';
import { ProductCatalogService } from './product-catalog.service';

const PRODUCTS = 'product_settings:products';

// O id que não é UUID responde como o que não existe
const ProductId = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException(PRODUCT_NOT_FOUND),
});

/**
 * O produto no cadastro: onde é usado e duplicar. Sem recurso de plano: a
 * composição só entra na cópia com a base de custos.
 */
@ApiTags('Produtos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('product')
export class ProductCatalogController {
  constructor(private readonly service: ProductCatalogService) {}

  @Get(':id/usage')
  @HasPermission('edit', PRODUCTS)
  @ApiOperation({
    summary: 'Onde o produto é usado: como parte e em orçamentos abertos',
  })
  usage(@Req() req, @Param('id', ProductId) id: string) {
    return this.service.usage(req.user.companyId, id);
  }

  @Post(':id/duplicate')
  @HasPermission('create', PRODUCTS)
  // O produto criado, no formato do GET /product/:id
  @MoneyFields(...PRODUCT_MONEY_FIELDS)
  @ApiOperation({ summary: 'Duplica o produto com a composição' })
  duplicate(
    @Req() req,
    @Param('id', ProductId) id: string,
    @Body() dto: DuplicateProductDto,
  ) {
    return this.service.duplicate(req.user.companyId, id, dto.name);
  }
}

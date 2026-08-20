import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { ProductFiscalService } from './product-fiscal.service';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
} from './dtos/product-fiscal.dto';

@ApiTags('Fiscal - Dados Fiscais de Produto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequiresFeature('nota_fiscal')
@Controller('fiscal/product')
export class ProductFiscalController {
  constructor(private readonly productFiscalService: ProductFiscalService) {}

  // Precede @Get(':productId') para não ser capturado como um productId.
  @Get('pendencias-fiscais')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Listar serviços com cadastro fiscal incompleto ou inválido',
  })
  async listarPendenciasFiscais(@Req() req) {
    return this.productFiscalService.listarPendenciasFiscais(
      req.user.companyId,
    );
  }

  @Get(':productId')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Obter dados fiscais de um produto' })
  async findByProductId(@Param('productId') productId: string) {
    return this.productFiscalService.findByProductId(productId);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar dados fiscais de um produto' })
  async create(@Body() dto: CreateProductFiscalDataDto) {
    return this.productFiscalService.create(dto);
  }

  @Put(':productId')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Atualizar dados fiscais de um produto' })
  async update(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductFiscalDataDto,
  ) {
    return this.productFiscalService.update(productId, dto);
  }

  @Post('upsert')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar ou atualizar dados fiscais de um produto' })
  async upsert(@Body() dto: CreateProductFiscalDataDto) {
    return this.productFiscalService.upsert(dto);
  }

  @Delete(':productId')
  @HasPermission('delete', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Deletar dados fiscais de um produto' })
  async delete(@Param('productId') productId: string) {
    return this.productFiscalService.delete(productId);
  }
}

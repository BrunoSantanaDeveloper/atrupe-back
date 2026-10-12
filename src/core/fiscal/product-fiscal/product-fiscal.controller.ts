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
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { TenantResource } from '../../auth/guards/tenant-resource.decorator';
import { PermissionsGuard } from '../../auth/abac/permissions.guard';
import { HasPermission } from '../../auth/abac/has-permission.decorator';
import { HasAnyPermission } from '../../auth/abac/has-any-permission.decorator';
import { FeatureGuard } from '../../plan/guards/feature.guard';
import { RequiresFeature } from '../../plan/decorators/requires-feature.decorator';
import { ProductFiscalService } from './product-fiscal.service';
import {
  CreateProductFiscalDataDto,
  UpdateProductFiscalDataDto,
  BulkUpdateNcmDto,
  ProductStRuleDto,
} from './dtos/product-fiscal.dto';

@ApiTags('Fiscal - Dados Fiscais de Produto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard, FeatureGuard)
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

  // Precede @Get(':productId'): sem isso "st-rules" seria lido como productId.
  @Get(':productId/st-rules')
  @TenantResource('product', 'productId')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Listar regras de ST do produto por UF' })
  async listStRules(@Param('productId') productId: string) {
    return this.productFiscalService.listStRules(productId);
  }

  @Put(':productId/st-rules')
  @TenantResource('product', 'productId')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar ou atualizar a regra de ST de uma UF' })
  async upsertStRule(
    @Param('productId') productId: string,
    @Body() dto: ProductStRuleDto,
  ) {
    return this.productFiscalService.upsertStRule(productId, dto);
  }

  @Delete(':productId/st-rules/:ufDestino')
  @TenantResource('product', 'productId')
  // A regra de ST é linha de dentro da configuração fiscal do produto: edit,
  // pela regra do time (salvar a regra já pede edit); delete também vale
  @HasAnyPermission(
    { action: 'edit', resource: 'nota_fiscal:config' },
    { action: 'delete', resource: 'nota_fiscal:config' },
  )
  @ApiOperation({ summary: 'Remover a regra de ST de uma UF' })
  async removeStRule(
    @Param('productId') productId: string,
    @Param('ufDestino') ufDestino: string,
  ) {
    return this.productFiscalService.removeStRule(productId, ufDestino);
  }

  @Get(':productId')
  @TenantResource('product', 'productId')
  @HasPermission('view', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Obter dados fiscais de um produto' })
  async findByProductId(@Param('productId') productId: string) {
    return this.productFiscalService.findByProductId(productId);
  }

  @Post()
  @HasPermission('create', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Criar dados fiscais de um produto' })
  async create(@Body() dto: CreateProductFiscalDataDto, @Req() req) {
    // O produto vem no corpo: o service confere a empresa
    return this.productFiscalService.create(dto, req.user.companyId);
  }

  @Put(':productId')
  @TenantResource('product', 'productId')
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
  async upsert(@Body() dto: CreateProductFiscalDataDto, @Req() req) {
    return this.productFiscalService.upsert(dto, req.user.companyId);
  }

  @Post('bulk-ncm')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Aplica um NCM a vários produtos de uma vez' })
  async bulkUpdateNcm(@Req() req, @Body() dto: BulkUpdateNcmDto) {
    // companyId sai do token: o service usa esse escopo para recusar produtos
    // de outra empresa, já que este controller não passa pelo TenantGuard.
    return this.productFiscalService.bulkUpdateNcm(req.user.companyId, dto);
  }

  @Post('bulk-ncm/count')
  @HasPermission('edit', 'nota_fiscal:config')
  @ApiOperation({
    summary: 'Quantos produtos a alteração de NCM em massa atingiria',
  })
  async contarAlvosBulkNcm(@Req() req, @Body() dto: BulkUpdateNcmDto) {
    return this.productFiscalService.contarAlvosBulkNcm(
      req.user.companyId,
      dto,
    );
  }

  @Delete(':productId')
  @TenantResource('product', 'productId')
  @HasPermission('delete', 'nota_fiscal:config')
  @ApiOperation({ summary: 'Deletar dados fiscais de um produto' })
  async delete(@Param('productId') productId: string) {
    return this.productFiscalService.delete(productId);
  }
}

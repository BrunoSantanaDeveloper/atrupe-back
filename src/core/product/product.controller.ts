import { ObservePermissions } from 'src/core/auth/abac/observe-permissions.decorator';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Patch,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductFilterDTO } from './dto/filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/abac/permissions.guard';
import { HasPermission } from '../auth/abac/has-permission.decorator';
import { MoneyFields } from '../auth/abac/money-fields.decorator';
import { PRODUCT_MONEY_FIELDS } from '../auth/abac/money-fields';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { TenantResource } from '../auth/guards/tenant-resource.decorator';
import { UpdateProductDto } from './dto/update-product.dto';
import { PlanControlService } from '../plan/plan-control.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { ToggleStatusDto } from './dto/toggle-status.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'product';
const UUID_ROUTE = ':id([0-9a-fA-F-]{36})';

@ApiTags('Produtos')
@UseGuards(JwtAuthGuard, PermissionsGuard, TenantGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly planControl: PlanControlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Composição (mais de um item) e etapas de produção são recursos de plano.
   * Só a INCLUSÃO é verificada: um produto que já tem composição ou etapas
   * segue editável em qualquer plano.
   */
  private async enforceProductFeatures(
    companyId: string,
    dto: {
      items?: unknown[];
      productionStages?: { isActive?: boolean }[];
      minQuantity?: number | null;
    },
    productId?: string,
  ) {
    const stored = productId
      ? await this.prisma.product.findUnique({
          where: { id: productId },
          select: {
            productionStages: true,
            minQuantity: true,
            _count: { select: { items: true } },
          },
        })
      : null;

    if ((dto.items?.length ?? 0) > 1 && (stored?._count.items ?? 0) <= 1) {
      await this.planControl.enforceFeature(companyId, 'product_composition');
    }
    // A quantidade mínima é do LITE em diante (27/10/2026), como as
    // variações e as faixas; o produto que já a tem segue editável
    if ((dto.minQuantity ?? 0) > 0 && !((stored?.minQuantity ?? 0) > 0)) {
      await this.planControl.enforceFeature(companyId, 'product_composition');
    }

    const hasStages = (dto.productionStages ?? []).some(
      (stage) => stage?.isActive !== false,
    );
    const storedStages = Array.isArray(stored?.productionStages)
      ? (stored.productionStages as { isActive?: boolean }[])
      : [];
    const hadStages = storedStages.some((stage) => stage?.isActive !== false);
    if (hasStages && !hadStages) {
      await this.planControl.enforceFeature(
        companyId,
        'product_production_stages',
      );
    }
  }

  @Post()
  @HasPermission('create', 'product_settings:products')
  @ApiOperation({ summary: 'Cria um novo produto' })
  @ApiResponse({
    status: 201,
    description: 'Produto criado com sucesso.',
  })
  async create(@Req() req, @Body() createProductDto: CreateProductDto) {
    createProductDto.companyId = req.user.companyId;
    await this.enforceProductFeatures(req.user.companyId, createProductDto);
    return await this.productService.create(createProductDto);
  }

  @Get()
  @MoneyFields(...PRODUCT_MONEY_FIELDS)
  // Listagem de produtos é uma operação OPERACIONAL necessária para qualquer usuário
  // autenticado da empresa (ex: vendedores criando orçamentos). A permissão
  // product_settings:products aplica-se apenas a operações de escrita (create/edit/delete).
  // O acesso multi-tenant já é garantido pelo JwtAuthGuard + TenantGuard (companyId do token).
  @ApiOperation({ summary: 'Obtém a lista de todos os produtos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: ProductFilterDTO) {
    filter.companyId = req.user.companyId;
    // O filtro da composição é da base de custos (contrato, módulo 1)
    if (filter.hasComposition !== undefined) {
      await this.planControl.enforceFeature(req.user.companyId, 'cost_base');
    }
    return await this.productService.findAll(filter);
  }

  @Get('export')
  @MoneyFields(...PRODUCT_MONEY_FIELDS)
  @HasPermission('export', 'product_settings:products')
  @ApiOperation({ summary: 'Obtém os produtos filtrados para exportação' })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos para exportação retornada com sucesso.',
  })
  async export(@Req() req, @Query() filter: ProductFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.productService.findAllForExport(filter);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os status de produtos',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de produtos retornada com sucesso.',
  })
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.productService.findAllQuantity(companyId);
  }

  @Get(UUID_ROUTE)
  @MoneyFields(...PRODUCT_MONEY_FIELDS)
  @TenantResource('product')
  @ApiOperation({ summary: 'Obtém um produto pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do produto' })
  @ApiResponse({
    status: 200,
    description: 'Produto retornado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado.',
  })
  async findOne(@Param('id') id: string) {
    return await this.productService.findOne(id);
  }

  @Patch(':id')
  @TenantResource('product')
  @HasPermission('edit', 'product_settings:products')
  @ApiOperation({ summary: 'Atualiza um produto pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do produto' })
  @ApiBody({
    description: 'Dados para atualização do produto',
    type: CreateProductDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Produto atualizado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    await this.enforceProductFeatures(
      req.user.companyId,
      updateProductDto as any,
      id,
    );
    return await this.productService.update(id, updateProductDto);
  }

  @Delete(':id')
  @TenantResource('product')
  @HasPermission('delete', 'product_settings:products')
  @ApiOperation({ summary: 'Remove um produto pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID do produto' })
  @ApiResponse({
    status: 200,
    description: 'Produto removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado.',
  })
  remove(@Param('id') id: string) {
    return this.productService.remove(id);
  }

  @Post(':id/toggle-status')
  @TenantResource('product')
  @HasPermission('edit', 'product_settings:products')
  @ApiOperation({ summary: 'Altera o status ativo/inativo de um produto' })
  @ApiParam({ name: 'id', required: true, description: 'ID do produto' })
  @ApiBody({
    description: 'Novo status do produto',
    type: ToggleStatusDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Status do produto alterado com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Produto não encontrado.',
  })
  async toggleStatus(
    @Param('id') id: string,
    @Body() toggleStatusDto: ToggleStatusDto,
  ) {
    return this.productService.toggleStatus(id, toggleStatusDto.isActive);
  }

  @Delete('item/:id')
  // Item é linha de dentro do produto: edit, pela regra do time
  @TenantResource('productItem', 'id', 'product')
  @HasPermission('edit', 'product_settings:products')
  @ApiOperation({ summary: 'Remove um item de um produto pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID do item de um produto',
  })
  @ApiResponse({
    status: 200,
    description: 'Item de Produto removido com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Item de Produto não encontrado.',
  })
  async removeItem(@Param('id') id: string) {
    return this.productService.removeItem(id);
  }

  @Post('import-csv')
  @HasPermission('create', 'product_settings:products')
  // Chave nova numa rota que estava livre: observar antes de recusar
  @ObservePermissions()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Import products from CSV file' })
  @ApiResponse({ status: 200, description: 'Products imported successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async importProductsFromCsv(@Req() req) {
    try {
      const filePath = 'src/helpers/payload/produtos.csv';
      await this.productService.createProductsFromCsv(
        filePath,
        req.user.companyId,
      );
      return { message: 'Products imported successfully' };
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Failed to import products', error.message);
    }
  }
}

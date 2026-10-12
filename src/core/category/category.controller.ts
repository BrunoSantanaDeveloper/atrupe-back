import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { CategoryKind } from '@prisma/client';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryFilterDTO } from './dto/filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AbacService } from '../auth/abac/abac.service';
import { permissionDenied } from '../auth/abac/permissions.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'category';

/**
 * A mesma rota serve a três telas, cada uma com a sua chave: grupos de
 * clientes e de fornecedores (o grupo faz parte do cadastro, decisão do time
 * de 24/09/2026) e grupos de produtos. Os tipos financeiros não têm tela;
 * ficam com o plano de contas.
 */
export const CATEGORY_KIND_PERMISSION: Record<CategoryKind, string> = {
  CLIENT: 'register:client',
  SUPPLIER: 'register:supplier',
  PRODUCT: 'product_settings:products',
  SERVICE: 'product_settings:products',
  PAYABLE: 'financial_settings:chart_accounts',
  RECEIVABLE: 'financial_settings:chart_accounts',
  PAYABLE_ORIGIN: 'financial_settings:chart_accounts',
  RECEIVABLE_ORIGIN: 'financial_settings:chart_accounts',
};

/**
 * As leituras ficam sem permissão: os formulários de cliente, fornecedor e
 * produto listam os grupos para escolher. A escrita confere a chave do tipo
 * no handler, porque o tipo vem do corpo (criar) ou do registro (alterar e
 * excluir).
 */
@ApiTags('Categorias')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class CategoryController {
  constructor(
    private readonly categoryService: CategoryService,
    private readonly abacService: AbacService,
  ) {}

  private async assertKindPermission(
    user: any,
    action: 'create' | 'edit' | 'delete',
    kinds: CategoryKind[],
  ) {
    const resources = Array.from(
      new Set(kinds.map((kind) => CATEGORY_KIND_PERMISSION[kind])),
    );
    for (const resource of resources) {
      if (!(await this.abacService.hasPermission(user, action, resource))) {
        throw permissionDenied([`${resource}:${action}`]);
      }
    }
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma nova categoria' })
  @ApiBody({
    description: 'Dados da nova categoria',
    type: CreateCategoryDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Categoria criada com sucesso.',
  })
  async create(@Req() req, @Body() createCategoryDto: CreateCategoryDto) {
    await this.assertKindPermission(req.user, 'create', [
      createCategoryDto.kind,
    ]);
    createCategoryDto.companyId = req.user.companyId;
    return this.categoryService.create(createCategoryDto);
  }

  @Get('quantity')
  @ApiOperation({
    summary: 'Obtém a quantidade de todos os colaboradores em seus status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de quantidade de colaboradores retornada com sucesso.',
  })
  async findAllQuantity(@Req() req, @Query() filter: CategoryFilterDTO) {
    filter.companyId = req.user.companyId;
    return this.categoryService.findAllQuantity(filter);
  }

  @Get('by-sector')
  @ApiOperation({ summary: 'Obtém a lista de todas as categorias' })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorias retornada com sucesso.',
    isArray: true,
  })
  async findAllBySector(@Req() req, @Query() filter: CategoryFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.categoryService.findAllBySector(filter);
  }

  @Get('with-products')
  @ApiOperation({ summary: 'Obtém a lista de todos os grupos com produtos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de grupos retornada com sucesso.',
    isArray: true,
  })
  async findAllWithProducts(@Req() req) {
    const companyId = req.user.companyId;
    return this.categoryService.findAllWithProducts(companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as categorias' })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorias retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: CategoryFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.categoryService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma categoria pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da categoria' })
  @ApiResponse({
    status: 200,
    description: 'Categoria retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Categoria não encontrada.',
  })
  findOne(@Req() req, @Param('id') id: string) {
    return this.categoryService.findOne(id, req.user.companyId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma categoria pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da categoria' })
  @ApiBody({
    description: 'Dados para atualização da categoria',
    type: UpdateCategoryDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Categoria atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Categoria não encontrada.',
  })
  async update(
    @Req() req,
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    const category = await this.categoryService.findOwn(id, req.user.companyId);
    // Trocar o tipo leva o grupo para a tela de outro cadastro: pede a
    // permissão dos dois
    const kinds = [category.kind];
    if (updateCategoryDto.kind && updateCategoryDto.kind !== category.kind) {
      kinds.push(updateCategoryDto.kind);
    }
    await this.assertKindPermission(req.user, 'edit', kinds);
    return this.categoryService.update(
      id,
      req.user.companyId,
      updateCategoryDto,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma categoria pelo ID' })
  @ApiParam({ name: 'id', required: true, description: 'ID da categoria' })
  @ApiResponse({
    status: 200,
    description: 'Categoria removida com sucesso.',
  })
  @ApiResponse({
    status: 400,
    description: 'Categoria está sendo utilizada e não pode ser removida.',
  })
  @ApiResponse({
    status: 404,
    description: 'Categoria não encontrada.',
  })
  async remove(@Req() req, @Param('id') id: string) {
    const category = await this.categoryService.findOwn(id, req.user.companyId);
    await this.assertKindPermission(req.user, 'delete', [category.kind]);
    return this.categoryService.remove(id, req.user.companyId);
  }
}

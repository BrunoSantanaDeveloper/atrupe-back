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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryFilterDTO } from './dto/filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'category';

@ApiTags('Categorias')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

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
  create(@Req() req, @Body() createCategoryDto: CreateCategoryDto) {
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
  async findAllQuantity(@Req() req) {
    const companyId = req.user.companyId;
    return this.categoryService.findAllQuantity(companyId);
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
  findOne(@Param('id') id: string) {
    return this.categoryService.findOne(id);
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
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoryService.update(id, updateCategoryDto);
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
  remove(@Param('id') id: string) {
    return this.categoryService.remove(id);
  }
}

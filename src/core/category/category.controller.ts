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
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'category';

@ApiTags('Categorias')
@UseGuards(JwtAuthGuard)
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
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoryService.create(createCategoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as categorias' })
  @ApiQuery({
    name: 'filter',
    description: 'Filtros opcionais para a busca de categorias',
    type: CategoryFilterDTO,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorias retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: CategoryFilterDTO) {
    return this.categoryService.findAll(filter);
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
    status: 404,
    description: 'Categoria não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.categoryService.remove(id);
  }
}

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
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductFilterDTO } from './dto/filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'product';

@ApiTags('Produtos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @ApiOperation({ summary: 'Cria um novo produto' })
  @ApiResponse({
    status: 201,
    description: 'Produto criado com sucesso.',
  })
  create(@Req() req, @Body() createProductDto: CreateProductDto) {
    createProductDto.companyId = req.user.companyId;
    return this.productService.create(createProductDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todos os produtos' })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos retornada com sucesso.',
    isArray: true,
  })
  async findAll(@Req() req, @Query() filter: ProductFilterDTO) {
    filter.companyId = req.user.companyId;
    return await this.productService.findAll(filter);
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

  @Get(':id')
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
  findOne(@Param('id') id: string) {
    return this.productService.findOne(id);
  }

  @Patch(':id')
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
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
  ) {
    return await this.productService.update(id, updateProductDto);
  }

  @Delete(':id')
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

  @Delete('item/:id')
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
}

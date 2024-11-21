import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { SeriesService } from './series.service';
import { CreateSeriesDto } from './dto/create-series.dto';
import { UpdateSeriesDto } from './dto/update-serie.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

@ApiTags('Séries de Vendas')
@Controller('sale/series')
export class SeriesController {
  constructor(private readonly service: SeriesService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova série de vendas' })
  @ApiBody({
    description: 'Dados da nova série de vendas',
    type: CreateSeriesDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Série de vendas criada com sucesso.',
  })
  create(@Body() dto: CreateSeriesDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as séries de vendas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de séries de vendas retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma série de vendas pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da série de vendas',
  })
  @ApiResponse({
    status: 200,
    description: 'Série de vendas retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Série de vendas não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma série de vendas pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da série de vendas',
  })
  @ApiBody({
    description: 'Dados para atualização da série de vendas',
    type: CreateSeriesDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Série de vendas atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Série de vendas não encontrada.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateSeriesDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma série de vendas pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da série de vendas',
  })
  @ApiResponse({
    status: 200,
    description: 'Série de vendas removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Série de vendas não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

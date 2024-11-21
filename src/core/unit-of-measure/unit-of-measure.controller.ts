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
import { UnitOfMeasureService } from './unit-of-measure.service';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UnitOfMeasureFilterDTO } from './dto/filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';

const RESOURCE = 'unit-of-measure';

@ApiTags('Unidades de Medida')
@UseGuards(JwtAuthGuard)
@Controller(RESOURCE)
export class UnitOfMeasureController {
  constructor(private readonly unitOfMeasureService: UnitOfMeasureService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova unidade de medida' })
  @ApiBody({
    description: 'Dados da nova unidade de medida',
    type: CreateUnitOfMeasureDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Unidade de medida criada com sucesso.',
  })
  create(@Body() createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    return this.unitOfMeasureService.create(createUnitOfMeasureDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as unidades de medida' })
  @ApiQuery({
    name: 'filter',
    description: 'Filtros opcionais para a busca de unidades de medida',
    type: UnitOfMeasureFilterDTO,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de unidades de medida retornada com sucesso.',
    isArray: true,
  })
  findAll(@Query() filter: UnitOfMeasureFilterDTO) {
    return this.unitOfMeasureService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtém uma unidade de medida pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da unidade de medida',
  })
  @ApiResponse({
    status: 200,
    description: 'Unidade de medida retornada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Unidade de medida não encontrada.',
  })
  findOne(@Param('id') id: string) {
    return this.unitOfMeasureService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza uma unidade de medida pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da unidade de medida',
  })
  @ApiBody({
    description: 'Dados para atualização da unidade de medida',
    type: UpdateUnitOfMeasureDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Unidade de medida atualizada com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Unidade de medida não encontrada.',
  })
  update(
    @Param('id') id: string,
    @Body() updateUnitOfMeasureDto: UpdateUnitOfMeasureDto,
  ) {
    return this.unitOfMeasureService.update(id, updateUnitOfMeasureDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma unidade de medida pelo ID' })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'ID da unidade de medida',
  })
  @ApiResponse({
    status: 200,
    description: 'Unidade de medida removida com sucesso.',
  })
  @ApiResponse({
    status: 404,
    description: 'Unidade de medida não encontrada.',
  })
  remove(@Param('id') id: string) {
    return this.unitOfMeasureService.remove(id);
  }
}

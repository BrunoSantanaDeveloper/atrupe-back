import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { UnitOfMeasureService } from './unit-of-measure.service';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { UpdateUnitOfMeasureDto } from './dto/update-unit-of-measure.dto';
import { UpdateDefaultVariantDto } from './dto/update-default-variant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';

const RESOURCE = 'unit-of-measure';

@ApiTags('Unidades de Medida')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
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
  create(@Req() req, @Body() createUnitOfMeasureDto: CreateUnitOfMeasureDto) {
    createUnitOfMeasureDto.companyId = req.user.companyId;
    return this.unitOfMeasureService.create(createUnitOfMeasureDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtém a lista de todas as unidades de medida' })
  @ApiResponse({
    status: 200,
    description: 'Lista de unidades de medida retornada com sucesso.',
    isArray: true,
  })
  findAll(@Req() req) {
    return this.unitOfMeasureService.findAll(req.user.companyId);
  }

  @Get('company-defaults')
  @ApiOperation({ summary: 'Obtém os padrões de unidades da empresa' })
  @ApiResponse({
    status: 200,
    description: 'Padrões de unidades da empresa retornados com sucesso.',
  })
  getCompanyUnitDefaults(@Req() req) {
    return this.unitOfMeasureService.getCompanyUnitDefaults(req.user.companyId);
  }

  @Get('variants/:kind')
  @ApiOperation({
    summary: 'Obtém as variantes disponíveis para um tipo de unidade',
  })
  @ApiParam({
    name: 'kind',
    required: true,
    description: 'Tipo de unidade de medida',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de variantes retornada com sucesso.',
  })
  getVariantsByKind(@Param('kind') kind: string) {
    return this.unitOfMeasureService.getVariantsByKind(kind);
  }

  @Get('by-kind/:kind')
  @ApiOperation({ summary: 'Obtém unidades de medida por tipo' })
  @ApiParam({
    name: 'kind',
    required: true,
    description: 'Tipo de unidade de medida',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de unidades de medida do tipo especificado.',
  })
  findByKind(@Req() req, @Param('kind') kind: string) {
    return this.unitOfMeasureService.findByKind(req.user.companyId, kind);
  }

  @Patch('default-variant/:kind')
  @ApiOperation({
    summary: 'Atualiza a variante padrão para um tipo de unidade',
  })
  @ApiParam({
    name: 'kind',
    required: true,
    description: 'Tipo de unidade de medida',
    enum: [
      'LENGTH',
      'WEIGHT',
      'CAPACITY',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'AREA',
    ],
  })
  @ApiBody({
    description: 'Nova variante padrão',
    type: UpdateDefaultVariantDto,
  })
  @ApiResponse({
    status: 200,
    description: 'Variante padrão atualizada com sucesso.',
  })
  updateDefaultVariant(
    @Req() req,
    @Param('kind') kind: string,
    @Body() updateDefaultVariantDto: UpdateDefaultVariantDto,
  ) {
    return this.unitOfMeasureService.updateDefaultVariant(
      req.user.companyId,
      kind,
      updateDefaultVariantDto,
    );
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

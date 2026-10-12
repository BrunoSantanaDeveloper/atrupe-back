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
import { SystemAdminGuard } from 'src/core/auth/guards/system-admin.guard';

const RESOURCE = 'unit-of-measure';

@ApiTags('Unidades de Medida')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller(RESOURCE)
export class UnitOfMeasureController {
  constructor(private readonly unitOfMeasureService: UnitOfMeasureService) {}

  @Post()
  // A unidade padrão é uma só para todas as empresas: só o superadmin
  // escreve (as telas só mexem nos padrões da empresa)
  @UseGuards(SystemAdminGuard)
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
  @ApiResponse({
    status: 200,
    description: 'Lista de unidades de medida retornada com sucesso.',
    isArray: true,
  })
  findAll() {
    return this.unitOfMeasureService.findAll();
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

  @Get('defaults')
  @ApiOperation({ summary: 'Obtém as unidades padrão da empresa para seleção' })
  @ApiResponse({
    status: 200,
    description: 'Unidades padrão da empresa retornadas com sucesso.',
    isArray: true,
  })
  getCompanyDefaultUnits(@Req() req) {
    return this.unitOfMeasureService.getCompanyDefaultUnits(req.user.companyId);
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

  @Get('variants/:kind/with-defaults')
  @ApiOperation({
    summary:
      'Obtém as variantes disponíveis para um tipo de unidade com padrão da empresa marcado',
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
    description:
      'Lista de variantes com padrão da empresa retornada com sucesso.',
  })
  getVariantsByKindWithDefaults(@Param('kind') kind: string, @Req() req) {
    const companyId = req.user.companyId;
    return this.unitOfMeasureService.getVariantsByKindWithDefaults(
      kind,
      companyId,
    );
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
  findByKind(@Param('kind') kind: string) {
    return this.unitOfMeasureService.findByKind(kind);
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
  @UseGuards(SystemAdminGuard)
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
  @UseGuards(SystemAdminGuard)
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

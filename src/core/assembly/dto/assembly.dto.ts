import { ApiProperty } from '@nestjs/swagger';
import {
  AssemblyBlockType,
  AssemblyDimension,
  AssemblyStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SaleRulesDto } from '../sale-rules';
import {
  CreateFieldDto,
  CreateFormulaDto,
  CreateLineDto,
  CreateOptionDto,
  UpdateFieldDto,
  UpdateFormulaDto,
  UpdateLineDto,
} from './composition.dto';

/** Etapas por composição, no máximo. */
export const MAX_BLOCKS = 60;

/**
 * Toda rota sob `/product/:id/assembly` aceita `variationId`: sem ele, vale a
 * composição padrão; com ele, a própria da variação.
 */
export class VariationRefDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

/** A leitura com cálculo, numa medida em mm (sem ela, a padrão do produto). */
export class AssemblyQueryDto extends VariationRefDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  @ApiProperty({ required: false })
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, description: 'mm' })
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, description: 'mm' })
  height?: number;
}

export class UpdateAssemblyDto extends VariationRefDto {
  @IsOptional()
  @IsEnum(AssemblyStatus)
  @ApiProperty({ required: false, enum: AssemblyStatus })
  status?: AssemblyStatus;

  @IsOptional()
  @IsEnum(AssemblyDimension)
  @ApiProperty({ required: false, enum: AssemblyDimension })
  dimension?: AssemblyDimension;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  allowRenameStages?: boolean;
}

export class CreateBlockDto extends VariationRefDto {
  @IsEnum(AssemblyBlockType)
  @ApiProperty({ enum: AssemblyBlockType })
  type: AssemblyBlockType;

  @IsOptional()
  @IsUUID('all', { message: 'Processo não encontrado' })
  @ApiProperty({ required: false })
  processId?: string;

  @IsOptional()
  @IsString({ message: 'Informe o nome da etapa' })
  @MaxLength(120)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha um setor ativo' })
  @ApiProperty({ required: false })
  sectorId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Parte sem composição' })
  @ApiProperty({ required: false })
  partProductId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BLOCKS)
  @IsString({ each: true })
  @ApiProperty({ required: false, type: [String] })
  dependsOn?: string[];

  @IsOptional()
  @IsString()
  @ApiProperty({
    required: false,
    description: 'A etapa que passa a depender da nova (FL-5)',
  })
  insertBefore?: string;
}

export class UpdateBlockDto extends VariationRefDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome da etapa' })
  @MaxLength(120)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false })
  taskType?: string;

  // Nulo volta às regras do processo
  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRulesDto)
  @ApiProperty({ required: false, nullable: true, type: SaleRulesDto })
  rules?: SaleRulesDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BLOCKS)
  @IsString({ each: true })
  @ApiProperty({ required: false, type: [String] })
  dependsOn?: string[];

  @IsOptional()
  @IsUUID('all', { message: 'Processo não encontrado' })
  @ApiProperty({ required: false })
  processId?: string;
}

export class NextStepQueryDto extends VariationRefDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  blockId?: string;
}

export class PartCandidateQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false, default: 1 })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({
    required: false,
    default: 50,
    description: 'Acima de 100 vale 100 (SEG-2)',
  })
  limit?: number;
}

/** A variação com composição própria, cópia da padrão ou de outra variação. */
export class CreateAssemblyVariationDto {
  @IsString({ message: 'Dê um nome à variação (P, M, G…)' })
  @MaxLength(80)
  @ApiProperty({ example: 'G' })
  name: string;

  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  copyFrom?: string | null;
}

/* As linhas, opções, campos e fórmulas do produto: o mesmo corpo do
   processo, mais a variação */

export class ProductCreateLineDto extends CreateLineDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductUpdateLineDto extends UpdateLineDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductCreateOptionDto extends CreateOptionDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductCreateFieldDto extends CreateFieldDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductUpdateFieldDto extends UpdateFieldDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductCreateFormulaDto extends CreateFormulaDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

export class ProductUpdateFormulaDto extends UpdateFormulaDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;
}

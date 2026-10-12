import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AssemblyLineKind, AssemblyLineMode } from '@prisma/client';
import { FORMULA_KEYS, FormulaKey } from '../engine/types';

/** Opções por linha e linhas por etapa, no máximo. */
export const MAX_OPTIONS = 50;

/**
 * Uma linha nova (IP-31). O mesmo corpo vale para a linha do processo e para
 * a da etapa do produto.
 */
export class CreateLineDto {
  @IsString({ message: 'Informe o nome da linha' })
  @MaxLength(120)
  @ApiProperty({ example: 'Papel' })
  name: string;

  @IsEnum(AssemblyLineKind)
  @ApiProperty({ enum: AssemblyLineKind })
  kind: AssemblyLineKind;

  @IsEnum(AssemblyLineMode)
  @ApiProperty({ enum: AssemblyLineMode })
  mode: AssemblyLineMode;

  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @IsString({ each: true })
  @ApiProperty({
    description: 'material:<id>[:<variação>], labor:<setor>, …',
    example: ['material:couche-150'],
  })
  resourceIds: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, default: 1 })
  perUnit?: number;

  @IsOptional()
  @IsIn(FORMULA_KEYS, { message: 'Fórmula desconhecida' })
  @ApiProperty({ required: false, enum: FORMULA_KEYS })
  formula?: FormulaKey;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  @ApiProperty({ required: false, default: 0, description: 'Percentual' })
  lossPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  minimum?: number | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  optional?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: true })
  optionalDefault?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false, nullable: true })
  fieldName?: string | null;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false, nullable: true })
  fieldDefault?: number | null;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, nullable: true })
  formulaId?: string | null;

  @IsOptional()
  @IsInt({ message: 'Pessoas é um número inteiro.' })
  @Min(1)
  @ApiProperty({ required: false, nullable: true })
  people?: number | null;
}

export class OptionValuesDto {
  @IsString()
  @ApiProperty()
  id: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  perUnit?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  @ApiProperty({ required: false, nullable: true })
  lossPercent?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  minimum?: number | null;
}

/** Ajuste da linha (IP-22, IP-26). Todos os campos são opcionais. */
export class UpdateLineDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome da linha' })
  @MaxLength(120)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  selectedId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false })
  perUnit?: number;

  @IsOptional()
  @IsIn(FORMULA_KEYS, { message: 'Fórmula desconhecida' })
  @ApiProperty({ required: false, enum: FORMULA_KEYS })
  formula?: FormulaKey;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  @ApiProperty({ required: false })
  lossPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  minimum?: number | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  optional?: boolean;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  optionalDefault?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true, description: 'mm' })
  sheetMargin?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true, description: 'mm' })
  sheetGap?: number | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, nullable: true })
  chargeWholeSheets?: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false, nullable: true })
  fieldName?: string | null;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false, nullable: true })
  fieldDefault?: number | null;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, nullable: true })
  formulaId?: string | null;

  @IsOptional()
  @IsInt({ message: 'Pessoas é um número inteiro.' })
  @Min(1)
  @ApiProperty({ required: false, nullable: true })
  people?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => OptionValuesDto)
  @ApiProperty({ required: false, type: [OptionValuesDto] })
  optionValues?: OptionValuesDto[];
}

export class CreateOptionDto {
  @IsString()
  @ApiProperty({ example: 'material:pvc-3mm' })
  resourceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false, nullable: true, example: 'Refile PVC' })
  configName?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  perUnit?: number | null;
}

export class CreateFieldDto {
  @IsString({ message: 'Informe o nome do campo' })
  @MaxLength(80)
  @ApiProperty({ example: 'Nº de letras' })
  name: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false, default: 0 })
  defaultValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, default: false })
  allowsFraction?: boolean;
}

export class UpdateFieldDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome do campo' })
  @MaxLength(80)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  defaultValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  allowsFraction?: boolean;
}

export class CreateFormulaDto {
  @IsString({ message: 'Dê um nome à fórmula' })
  @MaxLength(80)
  @ApiProperty({ example: 'Travessas' })
  name: string;

  @IsString({ message: 'Escreva a fórmula.' })
  @MaxLength(500)
  @ApiProperty({ example: '(largura - montante · X * 2) * 2' })
  expression: string;
}

export class UpdateFormulaDto {
  @IsOptional()
  @IsString({ message: 'Dê um nome à fórmula' })
  @MaxLength(80)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Escreva a fórmula.' })
  @MaxLength(500)
  @ApiProperty({ required: false })
  expression?: string;
}

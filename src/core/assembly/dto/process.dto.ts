import { ApiProperty } from '@nestjs/swagger';
import { ProcessAfterBase } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
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

export class CreateProcessDto {
  @IsString({ message: 'Informe o nome do processo' })
  @MaxLength(120)
  @ApiProperty({ example: 'Dupla face' })
  name: string;

  @IsUUID('all', { message: 'Escolha o setor do processo' })
  @ApiProperty()
  sectorId: string;

  @IsOptional()
  @IsEnum(ProcessAfterBase)
  @ApiProperty({ required: false, enum: ProcessAfterBase, default: 'INHERIT' })
  afterBase?: ProcessAfterBase;
}

export class UpdateProcessDto {
  @IsOptional()
  @IsString({ message: 'Informe o nome da etapa' })
  @MaxLength(120)
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha o setor do processo' })
  @ApiProperty({ required: false })
  sectorId?: string;

  @IsOptional()
  @IsEnum(ProcessAfterBase)
  @ApiProperty({ required: false, enum: ProcessAfterBase })
  afterBase?: ProcessAfterBase;

  @IsOptional()
  @IsInt({ message: 'O preparo é em minutos inteiros' })
  @Min(0, { message: 'O preparo não pode ser negativo' })
  @ApiProperty({ required: false, description: 'Minutos (CP-15)' })
  setupMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @ApiProperty({ required: false, description: 'CP-13' })
  sellerInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false, description: 'MS-8' })
  taskType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleRulesDto)
  @ApiProperty({ required: false, type: SaleRulesDto })
  rules?: SaleRulesDto;
}

export class ToggleProcessStatusDto {
  @IsBoolean()
  @ApiProperty()
  isActive: boolean;
}

export const PROCESS_STATUS = ['ativos', 'inativos'] as const;

export class ProcessFilterDto {
  @IsOptional()
  @IsIn(PROCESS_STATUS)
  @ApiProperty({ required: false, enum: PROCESS_STATUS, default: 'ativos' })
  status?: (typeof PROCESS_STATUS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false })
  search?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false })
  sectorId?: string;

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

/** A medida da simulação, em mm (CP-2, PAD-6), e a base simulada (§9.1). */
export class ProcessSimulationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  @ApiProperty({ required: false, default: 1 })
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, default: 1000, description: 'mm' })
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, default: 1000, description: 'mm' })
  height?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  @ApiProperty({ required: false })
  baseQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, description: 'mm' })
  baseWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, description: 'mm' })
  baseHeight?: number;
}

export class UsualNextDto {
  @IsUUID('all', { message: 'Processo não encontrado' })
  @ApiProperty()
  fromProcessId: string;

  @IsUUID('all', { message: 'Processo não encontrado' })
  @ApiProperty()
  toProcessId: string;

  @IsBoolean()
  @ApiProperty()
  usual: boolean;
}

export const RESOURCE_KINDS = [
  'MACHINE',
  'MATERIAL',
  'LABOR',
  'OUTSOURCED',
] as const;

export class ResourceFilterDto {
  @IsOptional()
  @IsIn(RESOURCE_KINDS)
  @ApiProperty({ required: false, enum: RESOURCE_KINDS })
  kind?: (typeof RESOURCE_KINDS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false })
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @ApiProperty({ required: false, description: 'A unidade da linha (IP-39)' })
  unit?: string;

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

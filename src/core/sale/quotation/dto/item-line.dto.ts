import { ApiProperty } from '@nestjs/swagger';
import { QuotationLineKind } from '@prisma/client';
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

export class LineMeasureDto {
  @IsNumber()
  @Min(0.0001, { message: 'Informe a quantidade da linha' })
  @ApiProperty()
  quantity: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'mm' })
  width: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'mm' })
  height: number;
}

export class LineFieldDto {
  @IsString()
  @ApiProperty()
  fieldId: string;

  @IsNumber()
  @Min(0)
  @ApiProperty()
  value: number;
}

/**
 * A linha acrescentada dentro do item (ORC-5): um processo, um item pronto do
 * catálogo (parte) ou um terceirizado avulso. Medidas em mm, dinheiro em
 * centavos.
 */
export class ItemLineDto {
  @IsEnum(QuotationLineKind, { message: 'Escolha o que acrescentar' })
  @ApiProperty({ enum: QuotationLineKind })
  kind: QuotationLineKind;

  @IsOptional()
  @IsUUID('all', { message: 'Processo não encontrado' })
  @ApiProperty({ required: false })
  processId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Produto não encontrado' })
  @ApiProperty({ required: false })
  productId?: string;

  // Ligado, a linha usa a medida do item e é refeita quando ela muda
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  followsBase?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => LineMeasureDto)
  @ApiProperty({ required: false, type: LineMeasureDto })
  measure?: LineMeasureDto;

  // Os campos do processo (km, tempo, pessoas)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineFieldDto)
  @ApiProperty({ required: false, type: [LineFieldDto] })
  fields?: LineFieldDto[];

  @IsOptional()
  @IsUUID('all', { message: 'Fornecedor não encontrado' })
  @ApiProperty({ required: false })
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false })
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false })
  description?: string;

  @IsOptional()
  @IsInt({ message: 'O custo vai em centavos' })
  @Min(0)
  @ApiProperty({ required: false })
  cost?: number;

  @IsOptional()
  @IsInt({ message: 'O preço vai em centavos' })
  @Min(0)
  @ApiProperty({ required: false })
  price?: number;
}

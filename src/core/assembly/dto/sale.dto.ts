import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const MAX_ENTRIES = 200;

export class SaleFormQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false })
  variationId?: string;
}

export class SaleMeasureDto {
  @IsNumber()
  @Min(0.0001)
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

export class SaleExtraDto {
  @IsString()
  @ApiProperty({ description: 'O campo do produto, ou block:<id> (legado)' })
  fieldId: string;

  @IsNumber()
  @ApiProperty()
  value: number;
}

export class SaleTimeDto {
  @IsString()
  @ApiProperty()
  blockId: string;

  @IsNumber()
  @Min(0)
  @ApiProperty({ description: 'Minutos' })
  minutes: number;
}

export class SaleChoiceDto {
  @IsString()
  @ApiProperty()
  blockId: string;

  @IsString()
  @ApiProperty()
  lineId: string;

  @IsString()
  @ApiProperty()
  optionId: string;
}

export class SaleOptionalDto {
  @IsString()
  @ApiProperty()
  blockId: string;

  @IsString()
  @ApiProperty()
  lineId: string;

  @IsBoolean()
  @ApiProperty()
  included: boolean;
}

export class SaleListEntryDto extends SaleChoiceDto {
  @IsNumber()
  @Min(0)
  @ApiProperty()
  quantity: number;
}

export class SaleNoteDto {
  @IsString()
  @ApiProperty()
  blockId: string;

  @IsString()
  @MaxLength(500)
  @ApiProperty()
  text: string;
}

/** As escolhas do vendedor para o relatório da composição (IP-36). */
export class SaleCompositionDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SaleMeasureDto)
  @ApiProperty({ required: false, type: SaleMeasureDto })
  measure?: SaleMeasureDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleExtraDto)
  @ApiProperty({ required: false, type: [SaleExtraDto] })
  extras?: SaleExtraDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleTimeDto)
  @ApiProperty({ required: false, type: [SaleTimeDto] })
  times?: SaleTimeDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleChoiceDto)
  @ApiProperty({ required: false, type: [SaleChoiceDto] })
  choices?: SaleChoiceDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleOptionalDto)
  @ApiProperty({ required: false, type: [SaleOptionalDto] })
  optionals?: SaleOptionalDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleListEntryDto)
  @ApiProperty({ required: false, type: [SaleListEntryDto] })
  lists?: SaleListEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SaleNoteDto)
  @ApiProperty({ required: false, type: [SaleNoteDto] })
  notes?: SaleNoteDto[];
}

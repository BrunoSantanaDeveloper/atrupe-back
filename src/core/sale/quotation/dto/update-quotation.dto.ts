import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  AddItemDto,
  CreateQuotationDto,
  QuotationProductDto,
  QuotationProductItemDto,
} from './create-quotation.dto';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { QuotationContactType } from '../entities/quotation.entity';

export class UpdateQuotationProductItemDto extends PartialType(
  OmitType(QuotationProductItemDto, ['productItemId'] as const),
) {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do item do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  productItemId?: string;

  @IsOptional()
  @Min(1)
  @ApiProperty({
    description: 'Quantidade do item do produto',
    example: 10,
    required: false,
  })
  quantity?: number;
}

export class UpdateQuotationProductDto extends PartialType(
  OmitType(QuotationProductDto, ['productId', 'items'] as const),
) {
  @IsOptional()
  @ApiProperty({
    description: 'ID do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  productId?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateQuotationProductItemDto)
  @ApiProperty({
    description: 'Itens do produto',
    type: [UpdateQuotationProductItemDto],
    required: false,
  })
  items?: UpdateQuotationProductItemDto[];
}

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description:
      'ID do cliente associado ao orçamento (opcional para atualização)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série do orçamento (opcional para atualização)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  serieId?: string;

  @IsOptional()
  @IsEnum(QuotationContactType)
  @ApiProperty({
    description: 'Tipo de contato do orçamento (opcional para atualização)',
    example: QuotationContactType.DIRECT,
    enum: QuotationContactType,
    required: false,
  })
  contactType?: QuotationContactType;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição do orçamento (opcional para atualização)',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  description?: string;
}

export class UpdateItemDto extends PartialType(AddItemDto) {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nota sobre o orçamento (opcional para atualização)',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  notes?: string;
  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Valor do disconto (opcional para ataulização)',
    example: 100,
    required: false,
  })
  discount?: number;
  @IsOptional()
  @IsString()
  @ApiProperty({
    description:
      'Tipo do disconto (PERCENT ou VALUE) (opcional para ataulização)',
    example: 'PERCENT',
    required: false,
  })
  discountType?: string;
}

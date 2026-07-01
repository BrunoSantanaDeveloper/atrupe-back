import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  AddItemDto,
  CreateQuotationDto,
  QuotationProductDto,
  QuotationProductItemDto,
} from './create-quotation.dto';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

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
  @IsUUID()
  @ApiProperty({
    description: 'ID do item do produto (para identificação durante update)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  id?: string;

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
      'ID da empresa associada ao orçamento (opcional para atualização)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  companyId?: string;

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
    description:
      'ID da fonte de contato do orçamento (opcional para atualização)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  contactSourceId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição do orçamento (opcional para atualização)',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  description?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da Tag do orçamento (opcional para atualização)',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  tagId?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data de aprovação retroativa (somente admin)',
    example: '2024-01-15T10:00:00.000Z',
    required: false,
  })
  approvedAt?: string;
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

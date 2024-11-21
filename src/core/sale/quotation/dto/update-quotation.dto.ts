import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  CreateQuotationDto,
  QuotationProductDto,
  QuotationProductItemDto,
} from './create-quotation.dto';
import {
  IsDateString,
  IsOptional,
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

export class UpdateQuotationDto extends PartialType(
  OmitType(CreateQuotationDto, [
    'companyId',
    'sellerId',
    'products',
    'serieId',
  ] as const),
) {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  companyId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do vendedor associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série do orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  serieId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  customerId?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateQuotationProductDto)
  @ApiProperty({
    description: 'Produtos associados ao orçamento',
    type: [UpdateQuotationProductDto],
    required: false,
  })
  products?: UpdateQuotationProductDto[];

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data de vencimento do orçamento',
    example: '2023-06-30',
    required: false,
  })
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description: 'Data de criação do orçamento',
    example: '2023-05-28',
    required: false,
  })
  createdAt?: string;
}

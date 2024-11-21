import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuotationContactType } from '../entities/quotation.entity';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class QuotationProductItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do item do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productItemId: string;

  @IsNotEmpty()
  @Min(1)
  @ApiProperty({
    description: 'Quantidade do item do produto',
    example: 10,
  })
  quantity: number;
}

export class QuotationProductDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productId: string;

  @IsNotEmpty()
  @Min(1)
  @ApiProperty({
    description: 'Quantidade do produto',
    example: 2,
  })
  quantity: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationProductItemDto)
  @ApiProperty({
    description: 'Itens do produto',
    type: [QuotationProductItemDto],
  })
  items: QuotationProductItemDto[];
}

export class CreateQuotationDto {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nome do orçamento',
    example: 'Orçamento de exemplo',
    required: false,
  })
  name: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série do orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  serieId: string;

  @IsOptional()
  @IsEnum(QuotationContactType)
  @ApiProperty({
    description: 'Tipo de contato do orçamento',
    example: QuotationContactType.DIRECT,
    enum: QuotationContactType,
    required: false,
  })
  contactType: QuotationContactType = QuotationContactType.DIRECT;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do vendedor associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  sellerId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição do orçamento',
    example: 'Este é um orçamento de exemplo.',
    required: false,
  })
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationProductDto)
  @ApiProperty({
    description: 'Produtos associados ao orçamento',
    type: [QuotationProductDto],
  })
  products: QuotationProductDto[];
}

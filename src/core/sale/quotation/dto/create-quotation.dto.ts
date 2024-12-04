import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
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

  @IsString()
  @ApiProperty({
    description: 'Nome do item do produto',
    example: 'Item Exemplo',
  })
  name: string;

  @IsUUID()
  @ApiProperty({
    description: 'ID da unidade de medida do item',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  unitOfMeasureId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Largura do item',
    example: 15.5,
    required: false,
  })
  width?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Altura do item',
    example: 20.0,
    required: false,
  })
  height?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Comprimento do item',
    example: 30.0,
    required: false,
  })
  length?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Peso do item',
    example: 5.0,
    required: false,
  })
  weight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Volume do item',
    example: 50.0,
    required: false,
  })
  volume?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Distância relacionada ao item',
    example: 100.0,
    required: false,
  })
  distance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Duração relacionada ao item (em dias)',
    example: 7.0,
    required: false,
  })
  duration?: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Quantidade do item do produto',
    example: 10,
  })
  quantity: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Custo unitário do item',
    example: 10.0,
    required: false,
  })
  unitCost?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Preço de venda do item',
    example: 20.0,
    required: false,
  })
  salePrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Valor total do item',
    example: 200.0,
    required: false,
  })
  totalValue?: number;
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

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição do produto',
    example: 'Produto com características especiais.',
    required: false,
  })
  description?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição técnica do produto',
    example: 'Descrição técnica detalhada.',
    required: false,
  })
  technicalDescription?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'URL da imagem do produto',
    example: 'https://example.com/image.png',
    required: false,
  })
  imageUrl?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Valor total do produto',
    example: 500.0,
    required: false,
  })
  totalValue?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationProductItemDto)
  @ApiProperty({
    description: 'Itens do produto',
    type: [QuotationProductItemDto],
  })
  items: QuotationProductItemDto[];

  @IsOptional()
  @ApiProperty({
    description: 'Permitir edição da descrição do produto',
    example: true,
    required: false,
  })
  allowEditDescription?: boolean;

  @IsOptional()
  @ApiProperty({
    description: 'Permitir edição dos valores do produto',
    example: true,
    required: false,
  })
  allowEditValues?: boolean;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente associado ao orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série do orçamento',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  seriesId?: string;

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
  description?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Valor total do orçamento',
    example: 1500.0,
    required: false,
  })
  totalValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'É venda rápida',
    example: false,
  })
  quickSale?: boolean;

  quotationNumber: number;

  // @IsArray()
  // @ValidateNested({ each: true })
  // @Type(() => QuotationProductDto)
  // @ApiProperty({
  //   description: 'Produtos incluídos no orçamento',
  //   type: [QuotationProductDto],
  // })
  // products: QuotationProductDto[];
}

export class AddProductItemDto {
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do item do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id?: string;

  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID da unidade de medida',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  unitOfMeasureId: string;

  @IsOptional()
  @ApiProperty({ description: 'Quantidade do item', example: 10 })
  quantity: number;

  @IsOptional()
  @ApiProperty({ description: 'Largura', example: 10.0 })
  width: number;

  @IsOptional()
  @ApiProperty({ description: 'Altura', example: 5.0 })
  height: number;

  @IsOptional()
  @ApiProperty({ description: 'Comprimento', example: 20.0 })
  length: number;

  @IsOptional()
  @ApiProperty({ description: 'Peso', example: 2.5 })
  weight: number;

  @IsOptional()
  @ApiProperty({ description: 'Volume', example: 100.0 })
  volume: number;

  @IsOptional()
  @ApiProperty({ description: 'Distância', example: 50.0 })
  distance: number;

  @IsOptional()
  @ApiProperty({ description: 'Duração (em dias)', example: 3 })
  duration: number;

  @IsOptional()
  @ApiProperty({ description: 'Custo unitário', example: 15.0 })
  unitCost: number;

  @IsOptional()
  @ApiProperty({ description: 'Preço de venda', example: 30.0 })
  salePrice: number;
}

export class AddItemDto {
  @IsUUID()
  @ApiProperty({
    description: 'ID do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  productId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição do produto',
    example: 'Descrição customizada',
  })
  description?: string;

  @Min(1)
  @ApiProperty({ description: 'Quantidade do produto', example: 2 })
  quantity: number;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'URL da imagem do produto',
    example: 'https://example.com/image.png',
  })
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Descrição técnica do produto',
    example: 'Descrição técnica',
  })
  technicalDescription?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddProductItemDto)
  @ApiProperty({ description: 'Itens do produto', type: [AddProductItemDto] })
  items: AddProductItemDto[];
}

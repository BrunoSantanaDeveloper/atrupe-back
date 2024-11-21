import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductItemDto {
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do item do produto (gerado automaticamente)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  id?: string;

  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do produto ao qual o item pertence',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  productId?: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do item do produto',
    example: 'Item Exemplo',
    required: true,
  })
  name: string;

  @IsUUID()
  @ApiProperty({
    description: 'ID da unidade de medida do item',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  unitOfMeasureId: string;

  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Custo unitário do item',
    example: 10.0,
    required: true,
  })
  unitCost: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Preço de venda do item',
    example: 20.0,
    required: true,
  })
  salePrice: number;
}

export class CreateProductDto {
  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID do produto (gerado automaticamente)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  id?: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do produto',
    example: 'Produto Exemplo',
    required: true,
  })
  name: string;

  @IsString()
  @ApiProperty({
    description: 'Código do produto',
    example: 'PROD001',
    required: true,
  })
  code: string;

  @IsBoolean()
  @ApiProperty({
    description: 'Indica se o produto está ativo',
    example: true,
    required: true,
  })
  isActive: boolean = true;

  @IsBoolean()
  @ApiProperty({
    description: 'Indica se o produto é padrão',
    example: false,
    required: true,
  })
  isStandard: boolean = false;

  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID da empresa associada ao produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  companyId?: string;

  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID da categoria do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  categoryId: string;

  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID do setor do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  sectorId: string;

  @IsUUID()
  @IsOptional()
  @ApiProperty({
    description: 'ID da unidade de medida do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  unitOfMeasureId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @ApiProperty({
    description: 'Custo unitário do produto',
    example: 100.0,
    required: false,
  })
  unitCost?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @ApiProperty({
    description: 'Preço de venda do produto',
    example: 200.0,
    required: false,
  })
  salePrice?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductItemDto)
  @IsOptional()
  @ApiProperty({
    description: 'Lista de itens do produto',
    type: [CreateProductItemDto],
    required: false,
  })
  items?: CreateProductItemDto[];
}

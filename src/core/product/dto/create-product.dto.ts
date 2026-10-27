import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnitKind } from '@prisma/client';

export class SectorDto {
  @ApiProperty({
    description: 'ID do setor para a etapa de produção',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  id: string;

  @ApiProperty({
    description: 'Se etapa está ativa ou não',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive: boolean = false;
}

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

  @IsEnum(UnitKind)
  @ApiProperty({
    description: 'Tipo da unidade de medida do item',
    enum: UnitKind,
    example: 'AREA',
    required: true,
  })
  unitKind: UnitKind;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Custo unitário do item (em centavos)',
    example: 15000,
    required: false,
  })
  unitCost?: number;

  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Preço de venda do item (em centavos)',
    example: 25000,
    required: true,
  })
  salePrice: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Largura do item (em milímetros)',
    example: 800,
    required: false,
  })
  width?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Altura do item (em milímetros)',
    example: 2100,
    required: false,
  })
  height?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Comprimento do item (em milímetros)',
    example: 1000,
    required: false,
  })
  length?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Peso do item (em miligramas)',
    example: 5000,
    required: false,
  })
  weight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Volume do item (em mililitros)',
    example: 50000,
    required: false,
  })
  volume?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Distância relacionada ao item (em metros)',
    example: 100,
    required: false,
  })
  distance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @ApiProperty({
    description: 'Duração relacionada ao item (em segundos)',
    example: 3600,
    required: false,
  })
  duration?: number;
}

export class CreateProductDto {
  // Produto terceirizado (T-5, 24/10/2026): comprado de fornecedor e
  // revendido; a venda aprovada gera a conta a pagar ao fornecedor
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false, example: false })
  isOutsourced?: boolean;

  // Custo do fornecedor por unidade de venda, na base do unitCost do item
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Informe o custo do fornecedor' })
  @ApiProperty({ required: false, example: 0.00004 })
  outsourcedCost?: number | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Fornecedor inválido' })
  @ApiProperty({ required: false, type: [String] })
  supplierIds?: string[];

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
  @ApiPropertyOptional({
    description: 'Indica se o produto está ativo',
    example: true,
    required: false,
  })
  isActive?: boolean = true;

  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Indica se o produto é padrão',
    example: false,
    required: false,
  })
  isStandard?: boolean = false;

  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Indica se o produto é um serviço',
    example: false,
    required: false,
  })
  isService?: boolean = false;

  companyId?: string;

  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID da categoria do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  categoryId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'url da imagem do produto',
    example: 'imageUrl.com',
    required: false,
  })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Tamanho da imagem do produto (small ou large)',
    example: 'small',
    required: false,
  })
  imageSize?: string;

  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID do setor do produto',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  sectorId: string;

  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Indica se é possível editar valores',
    example: true,
    required: false,
  })
  allowEditValues: boolean = true;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiPropertyOptional({
    description:
      'Quantidade mínima na unidade comercial do produto (0,5 m², 3 un): abaixo dela o item é cobrado pelo mínimo; nulo = sem mínimo',
    example: 0.5,
  })
  minQuantity?: number | null;

  @IsBoolean()
  @ApiPropertyOptional({
    description: 'Indica se é possível editar descrição',
    example: true,
    required: false,
  })
  allowEditDescription: boolean = true;

  @IsString()
  @ApiPropertyOptional({
    description: 'Descrição  técnica do produto',
    example: 'Descrição técnica do produto',
    required: false,
  })
  technicalDescription?: string;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectorDto)
  @IsOptional()
  @ApiProperty({
    description: 'Lista de etapas de produção (setores) do produto',
    type: [SectorDto],
    required: false,
  })
  productionStages?: SectorDto[];
}

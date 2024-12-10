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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    required: true,
  })
  imageUrl?: string;

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

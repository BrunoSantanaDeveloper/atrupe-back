import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';
import { CategoryKind, ProductStatus, UnitKind } from '@prisma/client';

export class ProductFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria para filtrar os produtos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  categoryId: string;

  @IsOptional()
  @IsEnum(UnitKind)
  @ApiProperty({
    description: 'Tipo da unidade de medida para filtrar os produtos',
    enum: UnitKind,
    example: UnitKind.AREA,
    required: false,
  })
  unitKind: UnitKind;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do setor para filtrar os produtos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sectorId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Campo de busca',
    example: 'Camisa',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  @ApiProperty({
    description: 'Filtrar produtos ativos ou inativos',
    example: ProductStatus.ACTIVE,
    required: false,
  })
  status: ProductStatus;

  @IsOptional()
  @IsEnum(CategoryKind)
  @ApiProperty({
    description: 'Filtrar por tipo de categoria (PRODUCT ou SERVICE)',
    enum: CategoryKind,
    example: CategoryKind.PRODUCT,
    required: false,
  })
  categoryKind: CategoryKind;

  @IsOptional()
  @ApiProperty({
    description: 'Filtrar produtos que são serviços',
    example: true,
    required: false,
  })
  @Transform(({ value }) => value === 'true' || value === true)
  isService?: boolean;

  // Com ou sem composição (CP-17); só com a base de custos
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  @ApiProperty({
    description: 'Com composição (true) ou sem (false)',
    required: false,
  })
  hasComposition?: boolean;

  // A lista do orçamento: sem o inativo, o em edição e a parte (IP-14)
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @ApiProperty({
    description:
      'Só os vendáveis: ativos e com composição liberada ou sem composição',
    required: false,
  })
  forSale?: boolean;
}

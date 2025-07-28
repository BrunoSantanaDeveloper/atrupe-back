import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';
import { ProductStatus, UnitKind } from '@prisma/client';

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
}

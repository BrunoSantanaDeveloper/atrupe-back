import { CategoryKind } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class CategoryFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsEnum(CategoryKind)
  @ApiProperty({
    description: 'Tipo da categoria para filtrar os resultados',
    example: CategoryKind.PRODUCT,
    enum: CategoryKind,
    required: false,
  })
  kind?: CategoryKind;

  @IsOptional()
  @ApiProperty({
    description: 'Texto de busca para filtrar as categorias',
    example: 'Categoria exemplo',
    required: false,
  })
  search?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Status da categoria para filtrar os resultados',
    example: 'ACTIVE',
    required: false,
  })
  status?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Id do setor para filtrar os resultados',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sectorId?: string;
}

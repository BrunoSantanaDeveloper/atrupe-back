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
  kind: CategoryKind;
}

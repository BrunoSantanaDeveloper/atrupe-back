import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

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
  @IsUUID()
  @ApiProperty({
    description: 'ID da unidade de medida para filtrar os produtos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  unitOfMeasureId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do setor para filtrar os produtos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sectorId: string;

  @IsOptional()
  @IsBooleanString()
  @ApiProperty({
    description: 'Filtrar produtos ativos (true/false)',
    example: 'true',
    required: false,
  })
  isActive: string;
}

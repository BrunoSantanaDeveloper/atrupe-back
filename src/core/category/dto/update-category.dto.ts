import { ApiProperty } from '@nestjs/swagger';
import { CategoryKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nome da categoria',
    example: 'Categoria de Exemplo',
  })
  name?: string;

  @IsOptional()
  @IsEnum(CategoryKind)
  @ApiProperty({
    description: 'Tipo da categoria',
    example: CategoryKind.PRODUCT,
    enum: CategoryKind,
  })
  kind?: CategoryKind;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Status da categoria',
    example: true,
    required: false,
  })
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID do setor',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  sectorId?: string;
}

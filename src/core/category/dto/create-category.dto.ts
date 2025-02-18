import { CategoryKind } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da categoria',
    example: 'Categoria de Exemplo',
  })
  name: string;

  @IsNotEmpty()
  @IsEnum(CategoryKind)
  @ApiProperty({
    description: 'Tipo da categoria',
    example: CategoryKind.PRODUCT,
    enum: CategoryKind,
  })
  kind: CategoryKind;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID do setor',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  sectorId?: string;

  companyId: string;
}

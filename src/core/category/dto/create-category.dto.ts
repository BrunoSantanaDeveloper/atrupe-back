import { CategoryKind } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
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

  companyId: string;
}

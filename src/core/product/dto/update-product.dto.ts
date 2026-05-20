import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductDto, CreateProductItemDto } from './create-product.dto';
import { ProductStatus } from '@prisma/client';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductItemDto extends PartialType(CreateProductItemDto) {}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['items'] as const),
) {
  status?: ProductStatus;

  /** Sobrescreve items com versão parcial para permitir updates sem name/unitKind */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductItemDto)
  @IsOptional()
  items?: UpdateProductItemDto[];
}

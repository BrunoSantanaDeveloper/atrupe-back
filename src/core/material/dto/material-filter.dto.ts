import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Teto de itens por página das listagens novas (SEG-2). */
export const MATERIAL_PAGE_LIMIT = 100;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class MaterialFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false, default: 1 })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({
    required: false,
    default: 10,
    description: `Acima de ${MATERIAL_PAGE_LIMIT} vale ${MATERIAL_PAGE_LIMIT}`,
  })
  limit?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    required: false,
    description: 'Nome ou código, sem acento e sem caixa',
  })
  search?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  @ApiProperty({ required: false, default: true })
  active?: boolean;

  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false })
  sectorId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  @ApiProperty({
    required: false,
    description:
      'Busca de venda direta do orçamento: a resposta nunca traz custo',
  })
  directSale?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  @ApiProperty({ required: false })
  productionMaterial?: boolean;
}

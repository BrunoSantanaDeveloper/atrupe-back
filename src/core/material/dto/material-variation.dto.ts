import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const trimAll = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

const CENTS = 'O valor vai em centavos, sem casas decimais.';

/** Cria em lote as combinações marca × cor, todas com o mesmo custo (MT-3). */
export class CreateMaterialVariationsDto {
  @Transform(trimAll)
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos uma marca' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'Informe ao menos uma marca' })
  @ApiProperty({ example: ['Marca X', 'Marca Y'] })
  brands: string[];

  @Transform(trimAll)
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos uma cor' })
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'Informe ao menos uma cor' })
  @ApiProperty({ example: ['Branca', 'Preta'] })
  colors: string[];

  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({ required: false, nullable: true, example: 1250 })
  cost?: number | null;

  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({ required: false, nullable: true })
  price?: number | null;
}

/** Custo e preço de uma combinação (MT-4): nulo = sem definição. */
export class UpdateMaterialVariationDto {
  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({ required: false, nullable: true, example: 1420 })
  cost?: number | null;

  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({ required: false, nullable: true, example: 3100 })
  price?: number | null;
}

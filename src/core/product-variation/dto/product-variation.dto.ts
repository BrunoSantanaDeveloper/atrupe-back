import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Variações por produto, no máximo. */
export const MAX_VARIATIONS = 100;

const CENTS = 'O preço vai em centavos, sem casas decimais.';
/** O papel da variação (Papéis no LITE, 13/10/2026). */
export const PAPER_OF_COMPANY = 'Escolha um papel da empresa';

export class ProductVariationRowDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    required: false,
    description: 'A variação que já existe; sem id, é uma nova',
  })
  id?: string;

  @IsString({ message: 'Dê um nome para cada variação' })
  @MaxLength(80)
  @ApiProperty({ example: 'M' })
  name: string;

  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Centavos por unidade comercial; nulo vale o preço do produto. Só é gravado de quem tem values:values:view',
    example: 5200,
  })
  unitPrice?: number | null;

  @IsOptional()
  @IsUUID(undefined, { message: PAPER_OF_COMPANY })
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'O papel da variação (material da empresa com a forma SHEET); nulo solta, ausente mantém o que estava',
  })
  paperId?: string | null;
}

/** A lista inteira das variações simples (PV-6): nome e preço. */
export class SaveProductVariationsDto {
  @IsArray()
  @ArrayMaxSize(MAX_VARIATIONS)
  @ValidateNested({ each: true })
  @Type(() => ProductVariationRowDto)
  @ApiProperty({ type: [ProductVariationRowDto] })
  variations: ProductVariationRowDto[];
}

/** Renomear a variação ou mudar o preço dela (PV-4). */
export class UpdateProductVariationDto {
  @IsOptional()
  @IsString({ message: 'Dê um nome à variação' })
  @MaxLength(80)
  @ApiProperty({ required: false, example: 'GG' })
  name?: string;

  @IsOptional()
  @IsInt({ message: CENTS })
  @Min(0)
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Nulo volta ao preço do produto',
  })
  unitPrice?: number | null;

  @IsOptional()
  @IsUUID(undefined, { message: PAPER_OF_COMPANY })
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'O papel da variação (material da empresa com a forma SHEET); nulo solta',
  })
  paperId?: string | null;
}

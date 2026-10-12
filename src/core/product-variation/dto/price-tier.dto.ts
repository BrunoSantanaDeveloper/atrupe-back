import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Faixas por tabela, no máximo. */
export const MAX_TIERS = 50;

export class PriceTierDto {
  @IsInt({ message: 'A faixa começa numa quantidade inteira.' })
  @Min(1, { message: 'A primeira faixa começa em 1 ou mais.' })
  @ApiProperty({ example: 101 })
  from: number;

  @IsInt({ message: 'O preço vai em centavos, sem casas decimais.' })
  @Min(0)
  @ApiProperty({
    description: 'Centavos por unidade comercial, sem arredondar para reais',
    example: 28,
  })
  unitPrice: number;
}

export class PriceTierQueryDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false })
  variationId?: string;
}

/** A tabela inteira do produto ou de uma variação (FQ-1 a FQ-4). */
export class SavePriceTiersDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ required: false, nullable: true })
  variationId?: string | null;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    required: false,
    description: 'Na variação: apaga a tabela dela e volta à do produto',
  })
  inherit?: boolean;

  @IsArray()
  @ArrayMaxSize(MAX_TIERS)
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  @ApiProperty({ type: [PriceTierDto] })
  tiers: PriceTierDto[];
}

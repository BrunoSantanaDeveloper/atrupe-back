import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** A sangria cabe entre 0 e 20 mm por lado; acima disso é erro de digitação. */
export const MAX_BLEED_MM = 20;

/** PUT /product/:id/print-settings: o que o produto define (nulo = herda). */
export class SavePrintSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_BLEED_MM)
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Sangria por lado em mm; nulo = a do setor',
  })
  bleedMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Folhas de acerto por trabalho; nulo = a do setor',
  })
  setupSheets?: number | null;
}

/** A sangria de um item do orçamento. */
export class PrintSpecDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_BLEED_MM)
  bleedMm?: number | null;
}

/** POST /product/:id/print-count: a prévia da contagem no item. */
export class PrintCountQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'Variação não encontrada' })
  variationId?: string | null;

  /** A medida da peça (tamanho final), em mm; sem ela, a do cadastro */
  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number | null;

  /** Peças vendidas */
  @IsNumber()
  @Min(0)
  quantity: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PrintSpecDto)
  printSpec?: PrintSpecDto | null;
}

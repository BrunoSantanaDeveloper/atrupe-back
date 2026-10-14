import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const QUANTITY = 'A quantidade é um número inteiro a partir de 1';

/** O material de venda direta como item do orçamento (ORG-1, Fase 4.4). */
export class AddMaterialItemDto {
  @IsUUID('4', { message: 'Material não encontrado' })
  materialId: string;

  // Obrigatória quando o material tem variações
  @IsOptional()
  @IsUUID('4', { message: 'Variação não encontrada' })
  variationId?: string | null;

  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity: number;
}

/** A quantidade e a variação do item de material; o material não muda. */
export class UpdateMaterialItemDto {
  @IsOptional()
  @IsUUID('4', { message: 'Variação não encontrada' })
  variationId?: string | null;

  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity: number;
}

import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** O atalho "Montar com IA": o texto do cliente e o orçamento aberto. */
export class AiQuotationDraftRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  text: string;

  @IsOptional()
  @IsUUID()
  quotationId?: string;
}

/**
 * O que a pessoa mudou no cartão antes de aplicar (cliente escolhido,
 * produto, variação, medida, item removido). O serviço de cada tipo confere
 * campo a campo; o que não reconhece, ignora.
 */
export class ApplyAiActionDto {
  @IsOptional()
  @IsObject()
  edited?: Record<string, unknown>;
}

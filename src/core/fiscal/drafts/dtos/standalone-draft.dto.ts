import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const DOC_TYPES_RASCUNHO = ['NFE', 'NFSE', 'NFCE'] as const;
export type DocTypeRascunho = (typeof DOC_TYPES_RASCUNHO)[number];

/**
 * Rascunho de nota avulsa.
 *
 * `payload` e' o corpo do formulario como ele seria enviado na emissao, sem
 * validacao de conteudo: o ponto do rascunho e' justamente guardar algo que
 * ainda nao fecha. Quem valida e' a emissao, quando o usuario mandar emitir.
 */
export class SaveStandaloneDraftDto {
  @ApiPropertyOptional({
    description: 'Id do rascunho a atualizar. Sem ele, cria um novo.',
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ enum: DOC_TYPES_RASCUNHO })
  @IsIn(DOC_TYPES_RASCUNHO as unknown as string[])
  docType!: DocTypeRascunho;

  @ApiPropertyOptional({ description: 'Resumo para a listagem.' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ description: 'Total em reais, só para exibição.' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  totalValue?: number;

  @ApiProperty({ description: 'Formulário inteiro, como seria emitido.' })
  @IsObject()
  payload!: Record<string, any>;
}

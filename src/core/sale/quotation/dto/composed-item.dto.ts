import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const QUANTITY = 'A quantidade é um número inteiro a partir de 1';
const MEASURE = 'A medida vai em milímetros, maior que zero';

/** Nome e medida do rascunho do item montado (ORC-11), medidas em mm. */
export class CreateComposedDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'O nome tem até 200 letras' })
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  height?: number;
}

/** Inclui o item montado a partir do rascunho. */
export class AddComposedItemDto {
  @IsUUID('4', { message: 'Item montado não encontrado' })
  draftId: string;

  @IsString({ message: 'Informe o nome do item' })
  @MaxLength(200, { message: 'O nome tem até 200 letras' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'O descritivo tem até 2.000 letras' })
  description?: string;

  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  height?: number;
}

/** Refaz o item montado com o rascunho de agora. */
export class UpdateComposedItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'O nome tem até 200 letras' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'O descritivo tem até 2.000 letras' })
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: QUANTITY })
  @Min(1, { message: QUANTITY })
  @Max(1000000, { message: 'A quantidade vai até 1.000.000' })
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: MEASURE })
  @Min(0.001, { message: MEASURE })
  height?: number;
}

/** "Salvar como produto": o nome do produto (sem ele, o do item). */
export class SaveDraftAsProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'O nome tem até 200 letras' })
  name?: string;
}

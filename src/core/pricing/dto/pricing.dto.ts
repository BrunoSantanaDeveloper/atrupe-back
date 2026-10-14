import { MaterialPriceRule } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PRICING_GROUPS = [
  'labor',
  'machines',
  'materials',
  'products',
] as const;
export type PricingGroup = (typeof PRICING_GROUPS)[number];

export const PRICING_STATUS = [
  'todos',
  'PRICED',
  'PENDING',
  'BELOW_COST',
  'NO_COST',
] as const;

const PARAM = 'Informe um número inteiro maior ou igual a zero';
const toInt = ({ value }) =>
  value === undefined || value === '' ? undefined : Number(value);

/** Os quatro parâmetros, em décimos de ponto (60 = 6,0 %). */
export class PricingParametersDto {
  @IsInt({ message: PARAM })
  @Min(0, { message: PARAM })
  taxation: number;

  @IsInt({ message: PARAM })
  @Min(0, { message: PARAM })
  commission: number;

  @IsInt({ message: PARAM })
  @Min(0, { message: PARAM })
  financialCost: number;

  @IsInt({ message: PARAM })
  @Min(0, { message: PARAM })
  desiredMargin: number;
}

export class PricingItemFilterDto {
  @IsIn(PRICING_GROUPS, { message: 'Grupo inválido' })
  group: PricingGroup;

  @IsOptional()
  @IsIn(PRICING_STATUS, { message: 'Situação inválida' })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'No máximo 100 por página' })
  limit?: number;
}

export class UpdatePricingItemDto {
  @IsIn(PRICING_GROUPS, { message: 'Grupo inválido' })
  group: PricingGroup;

  @IsEnum(MaterialPriceRule, { message: 'Regra inválida' })
  rule: MaterialPriceRule;

  // Centavos: no fixo, o preço; no variável, só conferência
  @IsOptional()
  @IsInt({ message: 'O preço vai em centavos' })
  @Min(0)
  price?: number;

  // O lucro do variável, em décimos de ponto
  @IsOptional()
  @IsInt({ message: 'O lucro vai em décimos de ponto' })
  @Min(0)
  profit?: number;
}

/** Aplicar o preço sugerido a vários itens (CP-7): prévia, depois confirmação. */
export class ApplySuggestedDto {
  @IsIn(PRICING_GROUPS, { message: 'Grupo inválido' })
  group: PricingGroup;

  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha ao menos um item' })
  @ArrayMaxSize(100, { message: 'No máximo 100 itens por vez' })
  @IsString({ each: true })
  ids: string[];

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}

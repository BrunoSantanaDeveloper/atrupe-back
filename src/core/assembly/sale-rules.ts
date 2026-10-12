import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DimensionRule,
  ExtraFieldKind,
  QuantityMode,
  SaleRules,
} from './engine/types';

const QUANTITY_MODES: QuantityMode[] = ['HIDDEN_ONE', 'FREE', 'AREA_RATIO'];
const DIMENSIONS: DimensionRule[] = [
  'NONE',
  'FREE_SIZE',
  'FREE_AREA',
  'FIXED_SIZE',
  'SAME_AS_PARENT',
];
const EXTRA_FIELDS: ExtraFieldKind[] = ['NONE', 'DECIMAL', 'INTEGER'];

/** As regras de base (MS-5): quantidade e medida livres, descrição editável. */
export const BASE_RULES: SaleRules = {
  quantityMode: 'FREE',
  followsBase: true,
  dimension: 'FREE_SIZE',
  timeField: false,
  timeFieldDefault: 0,
  extraField: 'NONE',
  extraFieldName: '',
  extraFieldDefault: 0,
  descriptionEditable: true,
};

/**
 * O acabamento herda a medida da base, esconde a quantidade e acompanha a
 * da base: o padrão que o legado mostra (MS-3 a MS-5).
 */
export const FINISHING_RULES: SaleRules = {
  ...BASE_RULES,
  quantityMode: 'HIDDEN_ONE',
  dimension: 'SAME_AS_PARENT',
  descriptionEditable: false,
};

/**
 * A regra de medida nasce da posição da etapa no produto (03/10/2026).
 * Depois de outra etapa, o processo que prefere herdar passa a usar a medida
 * e a quantidade da base; o que prefere a própria entra como está. Começando
 * um caminho, pede medida e quantidade próprias.
 */
export const rulesByPosition = (
  rules: SaleRules,
  afterBase: 'INHERIT' | 'OWN',
  dependsOn: string[],
): SaleRules => {
  if (dependsOn.length && afterBase === 'INHERIT') {
    return {
      ...rules,
      dimension: 'SAME_AS_PARENT',
      quantityMode: 'HIDDEN_ONE',
    };
  }
  if (rules.dimension !== 'SAME_AS_PARENT') return { ...rules };
  return {
    ...rules,
    dimension: 'FREE_SIZE',
    quantityMode:
      rules.quantityMode === 'HIDDEN_ONE' ? 'FREE' : rules.quantityMode,
  };
};

/**
 * As regras gravadas (JSON) com o que faltar completado pela base: o JSON
 * pode ter sido gravado antes de uma regra nova existir.
 */
export const rulesOf = (value: unknown): SaleRules => {
  const stored =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<SaleRules>)
      : {};
  return {
    quantityMode: QUANTITY_MODES.includes(stored.quantityMode as QuantityMode)
      ? (stored.quantityMode as QuantityMode)
      : BASE_RULES.quantityMode,
    followsBase:
      typeof stored.followsBase === 'boolean'
        ? stored.followsBase
        : BASE_RULES.followsBase,
    dimension: DIMENSIONS.includes(stored.dimension as DimensionRule)
      ? (stored.dimension as DimensionRule)
      : BASE_RULES.dimension,
    timeField:
      typeof stored.timeField === 'boolean'
        ? stored.timeField
        : BASE_RULES.timeField,
    timeFieldDefault:
      typeof stored.timeFieldDefault === 'number'
        ? stored.timeFieldDefault
        : BASE_RULES.timeFieldDefault,
    extraField: EXTRA_FIELDS.includes(stored.extraField as ExtraFieldKind)
      ? (stored.extraField as ExtraFieldKind)
      : BASE_RULES.extraField,
    extraFieldName:
      typeof stored.extraFieldName === 'string'
        ? stored.extraFieldName
        : BASE_RULES.extraFieldName,
    extraFieldDefault:
      typeof stored.extraFieldDefault === 'number'
        ? stored.extraFieldDefault
        : BASE_RULES.extraFieldDefault,
    descriptionEditable:
      typeof stored.descriptionEditable === 'boolean'
        ? stored.descriptionEditable
        : BASE_RULES.descriptionEditable,
  };
};

/**
 * As regras de venda no corpo (MS-3 a MS-6). Todas opcionais: o que não vier
 * fica como estava.
 */
export class SaleRulesDto {
  @IsOptional()
  @IsIn(QUANTITY_MODES)
  @ApiProperty({ required: false, enum: QUANTITY_MODES })
  quantityMode?: QuantityMode;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  followsBase?: boolean;

  @IsOptional()
  @IsIn(DIMENSIONS)
  @ApiProperty({ required: false, enum: DIMENSIONS })
  dimension?: DimensionRule;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  timeField?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false, description: 'Minutos (IP-32)' })
  timeFieldDefault?: number;

  @IsOptional()
  @IsIn(EXTRA_FIELDS)
  @ApiProperty({ required: false, enum: EXTRA_FIELDS })
  extraField?: ExtraFieldKind;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @ApiProperty({ required: false })
  extraFieldName?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  extraFieldDefault?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  descriptionEditable?: boolean;
}

/** As regras gravadas com as do corpo por cima. */
export const mergeRules = (
  current: SaleRules,
  patch: SaleRulesDto,
): SaleRules =>
  rulesOf({
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  });

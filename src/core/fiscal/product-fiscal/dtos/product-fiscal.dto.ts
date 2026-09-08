import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsUUID,
  Length,
  IsBoolean,
  IsEnum,
  IsIn,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CategoryKind, ProductStatus, UnitKind } from '@prisma/client';
import {
  IsCnae,
  IsCodigoServico,
} from '../../../../helpers/validators/fiscal-servico';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

// Helper to parse numeric strings or undefined
const parseNumber = ({ value }) => {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    value === '$undefined'
  ) {
    return undefined;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
};

export class CreateProductFiscalDataDto {
  @ApiProperty({ description: 'ID do produto' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiPropertyOptional({ description: 'NCM - Nomenclatura Comum do Mercosul' })
  @IsString()
  @IsOptional()
  ncm?: string;

  @ApiPropertyOptional({
    description: 'CEST - Código Especificador da Substituição Tributária',
  })
  @IsString()
  @IsOptional()
  cest?: string;

  @ApiPropertyOptional({ description: 'CEAN - Código de barras' })
  @IsString()
  @IsOptional()
  cean?: string;

  @ApiPropertyOptional({ description: 'Código do produto para NF-e' })
  @IsString()
  @IsOptional()
  productCode?: string;

  @ApiPropertyOptional({ description: 'Unidade comercial (UN, KG, M, etc.)' })
  @IsString()
  @IsOptional()
  commercialUnit?: string;

  @ApiPropertyOptional({ description: 'Origem da mercadoria (0-8)' })
  @IsString()
  @IsOptional()
  icmsOrigin?: string;

  @ApiPropertyOptional({ description: 'CST do ICMS' })
  @IsString()
  @IsOptional()
  icmsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ICMS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsRate?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do crédito ICMS (Simples Nacional)',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsCreditRate?: number;

  @ApiPropertyOptional({ description: 'Modalidade da base de cálculo ICMS' })
  @IsString()
  @IsOptional()
  icmsBaseModality?: string;

  @ApiPropertyOptional({
    description:
      'Margem de valor agregado da ST (%), por protocolo entre estados',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  icmsStMva?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo da ST (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsStReducao?: number;

  @ApiPropertyOptional({
    description: 'Alíquota interna do ICMS-ST na UF de destino (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsStRate?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do Fundo de Combate à Pobreza (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  fcpRate?: number;

  @ApiPropertyOptional({ description: 'Alíquota do FCP retido por ST (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  fcpStRate?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo ICMS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsReducao?: number;

  @ApiPropertyOptional({ description: 'CST do PIS' })
  @IsString()
  @IsOptional()
  pisCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do PIS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pisRate?: number;

  @ApiPropertyOptional({ description: 'CST do COFINS' })
  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do COFINS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  cofinsRate?: number;

  @ApiPropertyOptional({ description: 'CST do IPI' })
  @IsString()
  @IsOptional()
  ipiCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do IPI' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  ipiRate?: number;

  @ApiPropertyOptional({ description: 'Enquadramento do IPI' })
  @IsString()
  @IsOptional()
  ipiFramework?: string;

  @ApiPropertyOptional({ description: 'CFOP para venda dentro do estado' })
  @IsString()
  @IsOptional()
  cfopInState?: string;

  @ApiPropertyOptional({ description: 'CFOP para venda fora do estado' })
  @IsString()
  @IsOptional()
  cfopOutState?: string;

  @ApiPropertyOptional({ description: 'CFOP para exportação' })
  @IsString()
  @IsOptional()
  cfopExport?: string;

  // NFS-e fields
  @ApiPropertyOptional({
    description: 'Código do serviço municipal (LC 116/03)',
  })
  @IsString()
  @IsOptional()
  @IsCodigoServico()
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ISS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'Discriminação do serviço para NFS-e' })
  @IsString()
  @IsOptional()
  discriminacao?: string;

  @ApiPropertyOptional({
    description: 'Código tributação município (000/001/002/003)',
  })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  @ApiPropertyOptional({ description: 'CNAE vinculado ao serviço' })
  @IsString()
  @IsOptional()
  @IsCnae()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Nomenclatura Brasileira de Serviços' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({
    description: 'CST do IBS/CBS (ex.: 000 = tributação integral)',
  })
  @IsString()
  @IsOptional()
  cstIbsCbs?: string;

  @ApiPropertyOptional({ description: 'Classificação IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;
}

/** Teto por requisição no escopo SELECTED, e tamanho do lote no escopo ALL:
 * mantém cada transação curta e limita o estrago de um envio acidental. */
export const BULK_NCM_MAX_PRODUCTS = 500;

export type BulkNcmScope = 'SELECTED' | 'ALL';

/**
 * Filtros da listagem repetidos no corpo, para o escopo ALL atingir o mesmo
 * conjunto que a tela mostra. Mesmos nomes de `ProductFilterDTO`, sem
 * paginação e sem `companyId` — a empresa vem sempre do token.
 */
export class BulkNcmFiltersDto {
  @ApiPropertyOptional({ description: 'Busca por nome, código ou descrição' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'ID da categoria' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'ID do setor' })
  @IsUUID()
  @IsOptional()
  sectorId?: string;

  @ApiPropertyOptional({ enum: UnitKind })
  @IsEnum(UnitKind)
  @IsOptional()
  unitKind?: UnitKind;

  @ApiPropertyOptional({ enum: CategoryKind })
  @IsEnum(CategoryKind)
  @IsOptional()
  categoryKind?: CategoryKind;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @ApiPropertyOptional({ description: 'Somente serviços ou somente produtos' })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isService?: boolean;
}

export class BulkUpdateNcmDto {
  @ApiPropertyOptional({
    description:
      'SELECTED (padrão) aplica aos productIds informados; ALL aplica a todos ' +
      'os produtos da empresa que atendem aos filtros.',
    enum: ['SELECTED', 'ALL'],
    default: 'SELECTED',
  })
  @IsIn(['SELECTED', 'ALL'])
  @IsOptional()
  scope?: BulkNcmScope;

  @ApiPropertyOptional({
    description:
      'IDs dos produtos que receberão o NCM (obrigatório no escopo SELECTED)',
    type: [String],
  })
  // Obrigatório fora do escopo ALL: assim o corpo antigo ({ productIds, ncm })
  // continua válido e o front pode ir a produção antes ou depois do backend.
  @ValidateIf((dto: BulkUpdateNcmDto) => dto.scope !== 'ALL')
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_NCM_MAX_PRODUCTS)
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    description: 'Filtros da listagem, usados apenas no escopo ALL',
    type: BulkNcmFiltersDto,
  })
  @ValidateNested()
  @Type(() => BulkNcmFiltersDto)
  @IsOptional()
  filters?: BulkNcmFiltersDto;

  @ApiPropertyOptional({
    description:
      'Aplica somente a produtos sem NCM próprio: sem cadastro fiscal, com NCM ' +
      'vazio ou ainda com o NCM padrão do emissor. Preserva NCM ajustado à mão.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  onlyInheritedNcm?: boolean;

  @ApiProperty({ description: 'NCM de 8 dígitos aplicado a todos os produtos' })
  @IsString()
  @IsNotEmpty()
  ncm: string;
}

export class UpdateProductFiscalDataDto {
  @ApiPropertyOptional({ description: 'NCM - Nomenclatura Comum do Mercosul' })
  @IsString()
  @IsOptional()
  ncm?: string;

  @ApiPropertyOptional({
    description: 'CEST - Código Especificador da Substituição Tributária',
  })
  @IsString()
  @IsOptional()
  cest?: string;

  @ApiPropertyOptional({ description: 'CEAN - Código de barras' })
  @IsString()
  @IsOptional()
  cean?: string;

  @ApiPropertyOptional({ description: 'Código do produto para NF-e' })
  @IsString()
  @IsOptional()
  productCode?: string;

  @ApiPropertyOptional({ description: 'Unidade comercial (UN, KG, M, etc.)' })
  @IsString()
  @IsOptional()
  commercialUnit?: string;

  @ApiPropertyOptional({ description: 'Origem da mercadoria (0-8)' })
  @IsString()
  @IsOptional()
  icmsOrigin?: string;

  @ApiPropertyOptional({ description: 'CST do ICMS' })
  @IsString()
  @IsOptional()
  icmsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ICMS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsRate?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do crédito ICMS (Simples Nacional)',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsCreditRate?: number;

  @ApiPropertyOptional({ description: 'Modalidade da base de cálculo ICMS' })
  @IsString()
  @IsOptional()
  icmsBaseModality?: string;

  @ApiPropertyOptional({
    description:
      'Margem de valor agregado da ST (%), por protocolo entre estados',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  icmsStMva?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo da ST (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsStReducao?: number;

  @ApiPropertyOptional({
    description: 'Alíquota interna do ICMS-ST na UF de destino (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsStRate?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do Fundo de Combate à Pobreza (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  fcpRate?: number;

  @ApiPropertyOptional({ description: 'Alíquota do FCP retido por ST (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  fcpStRate?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo ICMS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsReducao?: number;

  @ApiPropertyOptional({ description: 'CST do PIS' })
  @IsString()
  @IsOptional()
  pisCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do PIS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pisRate?: number;

  @ApiPropertyOptional({ description: 'CST do COFINS' })
  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do COFINS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  cofinsRate?: number;

  @ApiPropertyOptional({ description: 'CST do IPI' })
  @IsString()
  @IsOptional()
  ipiCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do IPI' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  ipiRate?: number;

  @ApiPropertyOptional({ description: 'Enquadramento do IPI' })
  @IsString()
  @IsOptional()
  ipiFramework?: string;

  @ApiPropertyOptional({ description: 'CFOP para venda dentro do estado' })
  @IsString()
  @IsOptional()
  cfopInState?: string;

  @ApiPropertyOptional({ description: 'CFOP para venda fora do estado' })
  @IsString()
  @IsOptional()
  cfopOutState?: string;

  @ApiPropertyOptional({ description: 'CFOP para exportação' })
  @IsString()
  @IsOptional()
  cfopExport?: string;

  // NFS-e fields
  @ApiPropertyOptional({
    description: 'Código do serviço municipal (LC 116/03)',
  })
  @IsString()
  @IsOptional()
  @IsCodigoServico()
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ISS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'Discriminação do serviço para NFS-e' })
  @IsString()
  @IsOptional()
  discriminacao?: string;

  @ApiPropertyOptional({
    description: 'Código tributação município (000/001/002/003)',
  })
  @IsString()
  @IsOptional()
  codTribMunicipio?: string;

  @ApiPropertyOptional({ description: 'CNAE vinculado ao serviço' })
  @IsString()
  @IsOptional()
  @IsCnae()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Nomenclatura Brasileira de Serviços' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({
    description: 'CST do IBS/CBS (ex.: 000 = tributação integral)',
  })
  @IsString()
  @IsOptional()
  cstIbsCbs?: string;

  @ApiPropertyOptional({ description: 'Classificação IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;
}

/**
 * Regra de substituição tributária para uma UF de destino.
 *
 * A MVA e a alíquota interna vêm de protocolo entre estados e variam por
 * destino; sem regra para a UF, o cálculo usa os campos de ST do produto.
 */
export class ProductStRuleDto {
  @ApiProperty({ description: 'Sigla da UF de destino', example: 'SP' })
  @IsString()
  @Length(2, 2)
  ufDestino: string;

  @ApiPropertyOptional({ description: 'MVA-ST original do protocolo (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  mva?: number;

  @ApiPropertyOptional({
    description: 'Alíquota interna do ICMS na UF de destino (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaInterna?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo da ST (%)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  reducaoBase?: number;

  @ApiPropertyOptional({
    description: 'FCP retido por ST na UF de destino (%)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  fcpStRate?: number;
}

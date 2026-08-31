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
} from 'class-validator';
import {
  IsCnae,
  IsCodigoServico,
} from '../../../../helpers/validators/fiscal-servico';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

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

/** Teto por requisição: mantém a transação curta e limita o estrago de um
 * envio acidental. A tela seleciona no máximo uma página de produtos. */
export const BULK_NCM_MAX_PRODUCTS = 500;

export class BulkUpdateNcmDto {
  @ApiProperty({
    description: 'IDs dos produtos que receberão o NCM',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BULK_NCM_MAX_PRODUCTS)
  @IsUUID(undefined, { each: true })
  productIds: string[];

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

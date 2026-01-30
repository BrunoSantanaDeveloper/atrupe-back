import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
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
  cnae?: string;

  @ApiPropertyOptional({ description: 'Nomenclatura Brasileira de Serviços' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({ description: 'Classificação IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;
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
  cnae?: string;

  @ApiPropertyOptional({ description: 'Nomenclatura Brasileira de Serviços' })
  @IsString()
  @IsOptional()
  nbs?: string;

  @ApiPropertyOptional({ description: 'Código tributação nacional' })
  @IsString()
  @IsOptional()
  codTribNacional?: string;

  @ApiPropertyOptional({ description: 'Classificação IBS/CBS' })
  @IsString()
  @IsOptional()
  codClassificacao?: string;
}

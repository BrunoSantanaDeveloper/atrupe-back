import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    description: 'CFOP - Código Fiscal de Operações e Prestações',
  })
  @IsString()
  @IsOptional()
  cfop?: string;

  @ApiPropertyOptional({ description: 'Código do produto para NF-e' })
  @IsString()
  @IsOptional()
  productCode?: string;

  @ApiPropertyOptional({
    description: 'Unidade comercial (UN, KG, M, etc.)',
  })
  @IsString()
  @IsOptional()
  commercialUnit?: string;

  @ApiPropertyOptional({
    description: 'Origem da mercadoria (0-8)',
    minimum: 0,
    maximum: 8,
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(8)
  origem?: number;

  @ApiPropertyOptional({ description: 'CST do ICMS' })
  @IsString()
  @IsOptional()
  icmsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ICMS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsAliquota?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo ICMS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsReducao?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do crédito ICMS (Simples Nacional)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsCreditRate?: number;

  @ApiPropertyOptional({
    description: 'Modalidade da base de cálculo ICMS',
  })
  @IsInt()
  @IsOptional()
  icmsBaseModality?: number;

  @ApiPropertyOptional({ description: 'CST do PIS' })
  @IsString()
  @IsOptional()
  pisCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do PIS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pisAliquota?: number;

  @ApiPropertyOptional({ description: 'CST do COFINS' })
  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do COFINS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  cofinsAliquota?: number;

  @ApiPropertyOptional({ description: 'CST do IPI' })
  @IsString()
  @IsOptional()
  ipiCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do IPI' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  ipiAliquota?: number;

  @ApiPropertyOptional({ description: 'Enquadramento do IPI' })
  @IsString()
  @IsOptional()
  ipiFramework?: string;
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

  @ApiPropertyOptional({
    description: 'CFOP - Código Fiscal de Operações e Prestações',
  })
  @IsString()
  @IsOptional()
  cfop?: string;

  @ApiPropertyOptional({ description: 'Código do produto para NF-e' })
  @IsString()
  @IsOptional()
  productCode?: string;

  @ApiPropertyOptional({
    description: 'Unidade comercial (UN, KG, M, etc.)',
  })
  @IsString()
  @IsOptional()
  commercialUnit?: string;

  @ApiPropertyOptional({
    description: 'Origem da mercadoria (0-8)',
    minimum: 0,
    maximum: 8,
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(8)
  origem?: number;

  @ApiPropertyOptional({ description: 'CST do ICMS' })
  @IsString()
  @IsOptional()
  icmsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ICMS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsAliquota?: number;

  @ApiPropertyOptional({ description: 'Redução da base de cálculo ICMS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsReducao?: number;

  @ApiPropertyOptional({
    description: 'Alíquota do crédito ICMS (Simples Nacional)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  icmsCreditRate?: number;

  @ApiPropertyOptional({
    description: 'Modalidade da base de cálculo ICMS',
  })
  @IsInt()
  @IsOptional()
  icmsBaseModality?: number;

  @ApiPropertyOptional({ description: 'CST do PIS' })
  @IsString()
  @IsOptional()
  pisCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do PIS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  pisAliquota?: number;

  @ApiPropertyOptional({ description: 'CST do COFINS' })
  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do COFINS' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  cofinsAliquota?: number;

  @ApiPropertyOptional({ description: 'CST do IPI' })
  @IsString()
  @IsOptional()
  ipiCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota do IPI' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  ipiAliquota?: number;

  @ApiPropertyOptional({ description: 'Enquadramento do IPI' })
  @IsString()
  @IsOptional()
  ipiFramework?: string;
}

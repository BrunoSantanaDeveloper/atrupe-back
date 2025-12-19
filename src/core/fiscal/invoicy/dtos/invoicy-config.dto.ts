import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsEnum,
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

// Helper to handle empty strings as undefined
const emptyToUndefined = ({ value }) => {
  if (value === '' || value === '$undefined') {
    return undefined;
  }
  return value;
};

export class CreateInvoicyConfigDto {
  // Legacy field (for backwards compatibility)
  @ApiPropertyOptional({ description: 'Token da API do Invoicy (legado)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  apiToken?: string;

  // Note: partnerKey and accessKey are now global credentials from env vars (Atrupe as reseller)

  @ApiPropertyOptional({
    description: 'Ambiente: PRODUCAO ou HOMOLOGACAO',
    default: 'HOMOLOGACAO',
  })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  environment?: string;

  @ApiPropertyOptional({
    description: 'Ambiente: 1 = Produção, 2 = Homologação (legado)',
    default: 2,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(2)
  ambiente?: number;

  @ApiPropertyOptional({ description: 'CNPJ do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCnpj?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitIe?: string;

  @ApiPropertyOptional({ description: 'Inscrição Municipal do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitIm?: string;

  @ApiPropertyOptional({ description: 'Razão Social do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitRazaoSocial?: string;

  @ApiPropertyOptional({ description: 'Nome Fantasia do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitNomeFantasia?: string;

  @ApiPropertyOptional({
    description: 'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal',
    default: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(3)
  emitCrt?: number;

  @ApiPropertyOptional({ description: 'Endereço do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do endereço' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitNumero?: string;

  @ApiPropertyOptional({ description: 'Bairro do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCep?: string;

  @ApiPropertyOptional({ description: 'Código do município IBGE' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCmun?: string;

  @ApiPropertyOptional({ description: 'UF do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitUf?: string;

  @ApiPropertyOptional({
    description: 'Código do país (padrão: 1058 = Brasil)',
    default: '1058',
  })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitPais?: string;

  // NF-e fields
  @ApiPropertyOptional({ description: 'Série da NF-e (string)', default: '1' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfeSeries?: string;

  @ApiPropertyOptional({
    description: 'Série da NF-e (legado int)',
    default: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  serieNfe?: number;

  @ApiPropertyOptional({
    description: 'Próximo número da NF-e',
    default: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfeNextNumber?: number;

  @ApiPropertyOptional({
    description: 'Próximo número da NF-e (legado)',
    default: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoNumeroNfe?: number;

  // NFC-e fields
  @ApiPropertyOptional({ description: 'Série da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfceSeries?: string;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfceNextNumber?: number;

  // NFS-e fields
  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseSeries?: string;

  @ApiPropertyOptional({ description: 'Próximo número do RPS (NFS-e)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfseNextNumber?: number;

  @ApiPropertyOptional({ description: 'Código do serviço municipal' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ISS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIss?: number;

  // Defaults
  @ApiPropertyOptional({ description: 'CFOP padrão' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultCfop?: string;

  @ApiPropertyOptional({ description: 'Natureza da operação padrão' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultOperationNature?: string;

  @ApiPropertyOptional({ description: 'Informações fiscais complementares' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  taxInfoText?: string;
}

export class UpdateInvoicyConfigDto {
  // Legacy field
  @ApiPropertyOptional({ description: 'Token da API do Invoicy (legado)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  apiToken?: string;

  // Note: partnerKey and accessKey are now global credentials from env vars (Atrupe as reseller)

  @ApiPropertyOptional({
    description: 'Ambiente: PRODUCAO ou HOMOLOGACAO',
  })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  environment?: string;

  @ApiPropertyOptional({
    description: 'Ambiente: 1 = Produção, 2 = Homologação (legado)',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(2)
  ambiente?: number;

  @ApiPropertyOptional({ description: 'CNPJ do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCnpj?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitIe?: string;

  @ApiPropertyOptional({ description: 'Inscrição Municipal do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitIm?: string;

  @ApiPropertyOptional({ description: 'Razão Social do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitRazaoSocial?: string;

  @ApiPropertyOptional({ description: 'Nome Fantasia do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitNomeFantasia?: string;

  @ApiPropertyOptional({
    description: 'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(3)
  emitCrt?: number;

  @ApiPropertyOptional({ description: 'Endereço do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do endereço' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitNumero?: string;

  @ApiPropertyOptional({ description: 'Bairro do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCep?: string;

  @ApiPropertyOptional({ description: 'Código do município IBGE' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitCmun?: string;

  @ApiPropertyOptional({ description: 'UF do emitente' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitUf?: string;

  @ApiPropertyOptional({ description: 'Código do país' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  emitPais?: string;

  // NF-e fields
  @ApiPropertyOptional({ description: 'Série da NF-e (string)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfeSeries?: string;

  @ApiPropertyOptional({ description: 'Série da NF-e (legado int)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  serieNfe?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NF-e' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfeNextNumber?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NF-e (legado)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoNumeroNfe?: number;

  // NFC-e fields
  @ApiPropertyOptional({ description: 'Série da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfceSeries?: string;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfceNextNumber?: number;

  // NFS-e fields
  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseSeries?: string;

  @ApiPropertyOptional({ description: 'Próximo número do RPS (NFS-e)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfseNextNumber?: number;

  @ApiPropertyOptional({ description: 'Código do serviço municipal' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Alíquota do ISS' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIss?: number;

  // Defaults
  @ApiPropertyOptional({ description: 'CFOP padrão' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultCfop?: string;

  @ApiPropertyOptional({ description: 'Natureza da operação padrão' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultOperationNature?: string;

  @ApiPropertyOptional({ description: 'Informações fiscais complementares' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  taxInfoText?: string;

  @ApiPropertyOptional({ description: 'Configuração ativa' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

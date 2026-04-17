import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
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

// Helper to handle empty strings as undefined
const emptyToUndefined = ({ value }) => {
  if (value === '' || value === '$undefined') {
    return undefined;
  }
  return value;
};

export class CreateInvoicyConfigDto {
  @ApiProperty({
    description: 'Nome identificador do emissor (ex: "Matriz", "Filial SP")',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Define se é o emissor padrão da empresa',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

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

  @ApiPropertyOptional({ description: 'Série da NFC-e (Prisma)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  serieNfce?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfceNextNumber?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e (Prisma)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoNumeroNfce?: number;

  // NFS-e fields
  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseSeries?: string;

  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS) (Prisma)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  serieNfse?: string;

  @ApiPropertyOptional({ description: 'Próximo número do RPS (NFS-e)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfseNextNumber?: number;

  @ApiPropertyOptional({
    description: 'Próximo número do RPS (NFS-e) (Prisma)',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoRpsNfse?: number;

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
  @ApiPropertyOptional({
    description: 'NCM padrão para novos produtos (ex: 49119900)',
  })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultNcm?: string;

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
  @ApiPropertyOptional({
    description: 'Nome identificador do emissor (ex: "Matriz", "Filial SP")',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Define se é o emissor padrão da empresa',
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

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

  @ApiPropertyOptional({
    description: 'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(3)
  emitCrt?: number;

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

  @ApiPropertyOptional({ description: 'Série da NFC-e (Prisma)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  serieNfce?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfceNextNumber?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NFC-e (Prisma)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoNumeroNfce?: number;

  // NFS-e fields
  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseSeries?: string;

  @ApiPropertyOptional({ description: 'Série da NFS-e (RPS) (Prisma)' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  serieNfse?: string;

  @ApiPropertyOptional({ description: 'Próximo número do RPS (NFS-e)' })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  nfseNextNumber?: number;

  @ApiPropertyOptional({
    description: 'Próximo número do RPS (NFS-e) (Prisma)',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  proximoRpsNfse?: number;

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
  @ApiPropertyOptional({
    description: 'NCM padrão para novos produtos (ex: 49119900)',
  })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  defaultNcm?: string;

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

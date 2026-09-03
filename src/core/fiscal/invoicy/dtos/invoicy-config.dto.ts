import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNumber,
  IsInt,
  Min,
  Max,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// Helper to parse numeric strings or undefined
/**
 * Como parseNumber, mas preserva null: campos onde "vazio" é um valor
 * significativo (limpar o que estava salvo) e não "não mexer".
 */
const parseNullableInt = ({ value }) => {
  if (value === null || value === '' || value === '$undefined') return null;
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
};

/** Como parseNullableInt, para percentuais fracionários (alíquotas). */
const parseNullableNumber = ({ value }) => {
  if (value === null || value === '' || value === '$undefined') return null;
  if (value === undefined) return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
};

/** Campo de texto onde vazio significa "limpar o padrao salvo", nao "nao mexer". */
const emptyToNull = ({ value }) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '' || value === '$undefined')
    return null;
  return String(value).trim();
};

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
    description:
      'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal, 4 = MEI',
    default: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  // Teto em 3: CRT 3 (Regime Normal — Lucro Real e Presumido) esta' liberado
  // porque o calculo de ICMS/ST/DIFAL/PIS/COFINS/IPI por item existe e barra
  // a emissao quando falta dado, em vez de zerar imposto em silencio.
  // CRT 4 (MEI) continua fora: nao tem apuracao propria implementada.
  @Max(3, {
    message:
      'MEI (CRT 4) ainda não é suportado: não há apuração própria ' +
      'implementada para esse regime. Fale com o suporte.',
  })
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

  @ApiPropertyOptional({ description: 'ID do CSC da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  cscId?: string;

  @ApiPropertyOptional({ description: 'Token CSC da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  cscToken?: string;

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

  @ApiPropertyOptional({
    description:
      'Regime Especial de Tributação da NFS-e. 1..6 é a enumeração ABRASF ' +
      '(1=Microempresa municipal, 2=Estimativa, 3=Sociedade de profissionais, ' +
      '4=Cooperativa, 5=MEI, 6=ME/EPP); 7..16 são valores exclusivos do ' +
      'provedor da prefeitura (Elotech/GLC, E&L, Digifred, SEMFAZ, ' +
      'NF-Eletrônica, PRODEVAL). Vazio omite a tag.',
  })
  @Transform(parseNullableInt)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(16)
  regimeEspecialTributacao?: number | null;

  @ApiPropertyOptional({
    description:
      'Prazo de cancelamento da NFC-e em minutos (varia por UF; SP usa 30)',
    default: 30,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1440)
  prazoCancelamentoNfce?: number;

  // ── Reforma Tributária (IBS/CBS) ──

  @ApiPropertyOptional({
    description:
      'NFS-e: envia o grupo de VALORES do IBS/CBS. Opcional no layout e ' +
      'exigido por parte dos municípios — por isso liga-se emissor a emissor.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  ibsCbsEnviarValores?: boolean;

  @ApiPropertyOptional({
    description:
      'NF-e/NFC-e: o grupo IBS/CBS só existe no layout paralelo da Reforma no ' +
      'provedor, que o ativa por empresa e por módulo. Espelha o campo ' +
      'AtivacaoReformaTributaria da consulta de cadastro: ligar sem o ' +
      'provedor ter ativado faz o grupo ser ignorado em silêncio.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  reformaTributariaAtiva?: boolean;

  @ApiPropertyOptional({
    description:
      'Código indicador da operação (cIndOp) padrão da NFS-e. Obrigatório no ' +
      'layout da Reforma e estável para a maioria dos emissores; usado quando ' +
      'a emissão não informa outro. Vazio limpa o padrão.',
    example: '100301',
  })
  @IsString()
  @IsOptional()
  @Length(0, 6)
  @Transform(emptyToNull)
  indicadorOperacaoNfse?: string | null;

  @ApiPropertyOptional({
    description:
      'Regime de apuração do IBS/CBS no Simples Nacional. ' +
      '1=IBS e CBS pelo SN, 2=CBS pelo SN e IBS regular, 3=ambos regulares.',
  })
  @Transform(parseNullableInt)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3)
  regApIbsCbsSn?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota do IBS estadual em percentual. Vazio usa o padrão nacional ' +
      'da fase vigente (0,1% na fase de teste de 2026).',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIbsUf?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota do IBS municipal em percentual. Definida por cada município, ' +
      'por isso vive no emissor. Vazio usa o padrão nacional da fase vigente.',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIbsMun?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota da CBS em percentual. Vazio usa o padrão nacional da fase ' +
      'vigente (0,9% na fase de teste de 2026).',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaCbs?: number | null;

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

  @ApiPropertyOptional({
    description:
      'Envia DANFE/XML automaticamente ao destinatário após autorização',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  sendDanfeXmlAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'Inclui o link do DANFE no e-mail fiscal',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  sendDanfeAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'Anexa o XML autorizado no e-mail fiscal',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  sendXmlAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'E-mail adicional para receber copia do envio fiscal',
  })
  @IsEmail()
  @IsOptional()
  @Transform(emptyToUndefined)
  sendFiscalEmailCopyTo?: string;

  // Os campos abaixo existiam apenas no UpdateInvoicyConfigDto, mas o
  // formulário de emissor os envia em TODO save — inclusive na criação. Com
  // forbidNonWhitelisted global (app.module.ts:45), o POST voltava 400
  // "property isActive should not exist" e nenhum emissor novo era criado.
  @ApiPropertyOptional({ description: 'Configuração ativa' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NF-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfeNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';

  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NFC-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfceNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';

  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NFS-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';
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
    description:
      'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal, 4 = MEI',
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  // Teto em 3: CRT 3 (Regime Normal — Lucro Real e Presumido) esta' liberado
  // porque o calculo de ICMS/ST/DIFAL/PIS/COFINS/IPI por item existe e barra
  // a emissao quando falta dado, em vez de zerar imposto em silencio.
  // CRT 4 (MEI) continua fora: nao tem apuracao propria implementada.
  @Max(3, {
    message:
      'MEI (CRT 4) ainda não é suportado: não há apuração própria ' +
      'implementada para esse regime. Fale com o suporte.',
  })
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

  // Ambiente a que a numeração informada se aplica.
  //
  // A numeração vive em invoicy_environment_configs por (emissor, ambiente,
  // docType) desde a Fase 3. Sem dizer o ambiente, o PATCH gravava apenas a
  // coluna legada global de invoicy_configs — que a emissão não lê — e o valor
  // digitado não tinha efeito nenhum. Quando omitido, vale o ambiente ativo
  // daquele docType.
  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NF-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfeNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';

  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NFC-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfceNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';

  @ApiPropertyOptional({
    description: 'Ambiente da numeração de NFS-e informada',
    enum: ['HOMOLOGACAO', 'PRODUCAO'],
  })
  @IsIn(['HOMOLOGACAO', 'PRODUCAO'])
  @IsOptional()
  @Transform(emptyToUndefined)
  nfseNumberingEnvironment?: 'HOMOLOGACAO' | 'PRODUCAO';

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

  @ApiPropertyOptional({ description: 'ID do CSC da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  cscId?: string;

  @ApiPropertyOptional({ description: 'Token CSC da NFC-e' })
  @IsString()
  @IsOptional()
  @Transform(emptyToUndefined)
  cscToken?: string;

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

  @ApiPropertyOptional({
    description:
      'Regime Especial de Tributação da NFS-e. 1..6 é a enumeração ABRASF ' +
      '(1=Microempresa municipal, 2=Estimativa, 3=Sociedade de profissionais, ' +
      '4=Cooperativa, 5=MEI, 6=ME/EPP); 7..16 são valores exclusivos do ' +
      'provedor da prefeitura (Elotech/GLC, E&L, Digifred, SEMFAZ, ' +
      'NF-Eletrônica, PRODEVAL). Vazio omite a tag.',
  })
  @Transform(parseNullableInt)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(16)
  regimeEspecialTributacao?: number | null;

  @ApiPropertyOptional({
    description:
      'Prazo de cancelamento da NFC-e em minutos (varia por UF; SP usa 30)',
    default: 30,
  })
  @Transform(parseNumber)
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(1440)
  prazoCancelamentoNfce?: number;

  // ── Reforma Tributária (IBS/CBS) ──

  @ApiPropertyOptional({
    description:
      'NFS-e: envia o grupo de VALORES do IBS/CBS. Opcional no layout e ' +
      'exigido por parte dos municípios — por isso liga-se emissor a emissor.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  ibsCbsEnviarValores?: boolean;

  @ApiPropertyOptional({
    description:
      'NF-e/NFC-e: o grupo IBS/CBS só existe no layout paralelo da Reforma no ' +
      'provedor, que o ativa por empresa e por módulo. Espelha o campo ' +
      'AtivacaoReformaTributaria da consulta de cadastro: ligar sem o ' +
      'provedor ter ativado faz o grupo ser ignorado em silêncio.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  reformaTributariaAtiva?: boolean;

  @ApiPropertyOptional({
    description:
      'Código indicador da operação (cIndOp) padrão da NFS-e. Obrigatório no ' +
      'layout da Reforma e estável para a maioria dos emissores; usado quando ' +
      'a emissão não informa outro. Vazio limpa o padrão.',
    example: '100301',
  })
  @IsString()
  @IsOptional()
  @Length(0, 6)
  @Transform(emptyToNull)
  indicadorOperacaoNfse?: string | null;

  @ApiPropertyOptional({
    description:
      'Regime de apuração do IBS/CBS no Simples Nacional. ' +
      '1=IBS e CBS pelo SN, 2=CBS pelo SN e IBS regular, 3=ambos regulares.',
  })
  @Transform(parseNullableInt)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3)
  regApIbsCbsSn?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota do IBS estadual em percentual. Vazio usa o padrão nacional ' +
      'da fase vigente (0,1% na fase de teste de 2026).',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIbsUf?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota do IBS municipal em percentual. Definida por cada município, ' +
      'por isso vive no emissor. Vazio usa o padrão nacional da fase vigente.',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaIbsMun?: number | null;

  @ApiPropertyOptional({
    description:
      'Alíquota da CBS em percentual. Vazio usa o padrão nacional da fase ' +
      'vigente (0,9% na fase de teste de 2026).',
  })
  @Transform(parseNullableNumber)
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  aliquotaCbs?: number | null;

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

  @ApiPropertyOptional({
    description:
      'Envia DANFE/XML automaticamente ao destinatário após autorização',
  })
  @IsBoolean()
  @IsOptional()
  sendDanfeXmlAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'Inclui o link do DANFE no e-mail fiscal',
  })
  @IsBoolean()
  @IsOptional()
  sendDanfeAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'Anexa o XML autorizado no e-mail fiscal',
  })
  @IsBoolean()
  @IsOptional()
  sendXmlAutomatically?: boolean;

  @ApiPropertyOptional({
    description: 'E-mail adicional para receber copia do envio fiscal',
  })
  @IsEmail()
  @IsOptional()
  @Transform(emptyToUndefined)
  sendFiscalEmailCopyTo?: string;
}

export class SetCscDto {
  @ApiProperty({ description: 'ID do CSC (Código de Segurança do Consumidor)' })
  @IsString()
  @IsNotEmpty()
  cscId: string;

  @ApiProperty({ description: 'Token CSC (Código de Segurança do Consumidor)' })
  @IsString()
  @IsNotEmpty()
  cscToken: string;
}

export class SetAccessKeyDto {
  @ApiProperty({ description: 'Chave de acesso Invoicy da empresa' })
  @IsString()
  @IsNotEmpty()
  accessKey: string;
}

export class SetNfceNumberingDto {
  @ApiProperty({ description: 'Série da NFC-e para o ambiente', minimum: 1 })
  @Transform(parseNumber)
  @IsNumber()
  @Min(1)
  nfceSeries: number;

  @ApiProperty({
    description: 'Próximo número da NFC-e para o ambiente',
    minimum: 1,
  })
  @Transform(parseNumber)
  @IsNumber()
  @Min(1)
  nfceNextNumber: number;
}

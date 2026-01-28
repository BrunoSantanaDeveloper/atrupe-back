import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfeStatus } from '@prisma/client';

export class NfeItemDto {
  @ApiProperty({ description: 'ID do produto' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ description: 'Quantidade' })
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @ApiProperty({ description: 'Valor unitário' })
  @IsNumber()
  @Min(0)
  unitValue: number;

  @ApiPropertyOptional({ description: 'Desconto' })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiPropertyOptional({ description: 'Descrição do produto' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'NCM' })
  @IsString()
  @IsOptional()
  ncm?: string;

  @ApiPropertyOptional({ description: 'CFOP' })
  @IsInt()
  @IsOptional()
  cfop?: number;

  @ApiPropertyOptional({ description: 'Unidade Comercial' })
  @IsString()
  @IsOptional()
  uCom?: string;

  @ApiPropertyOptional({ description: 'GTIN/EAN' })
  @IsString()
  @IsOptional()
  ean?: string;

  @ApiPropertyOptional({ description: 'GTIN/EAN Tributável' })
  @IsString()
  @IsOptional()
  ceantrib?: string;

  @ApiPropertyOptional({ description: 'CST ICMS' })
  @IsString()
  @IsOptional()
  cstIcms?: string;

  @ApiPropertyOptional({ description: 'CST PIS' })
  @IsString()
  @IsOptional()
  cstPis?: string;

  @ApiPropertyOptional({ description: 'CST COFINS' })
  @IsString()
  @IsOptional()
  cstCofins?: string;

  @ApiPropertyOptional({ description: 'CST IPI' })
  @IsString()
  @IsOptional()
  cstIpi?: string;

  @ApiPropertyOptional({ description: 'Valor do Frete' })
  @IsNumber()
  @IsOptional()
  freight?: number;

  @ApiPropertyOptional({ description: 'Valor do Seguro' })
  @IsNumber()
  @IsOptional()
  insurance?: number;
}

// DTO simplificado para emissão a partir de uma ordem
export class EmitNfeFromOrderDto {
  @ApiProperty({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiPropertyOptional({ description: 'Natureza da operação' })
  @IsString()
  @IsOptional()
  operationNature?: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  additionalInfo?: string;
}

// DTO completo para emissão manual com todos os dados
export class NfeTransportDto {
  @ApiPropertyOptional({ description: 'CNPJ/CPF da transportadora' })
  @IsString()
  @IsOptional()
  cnpjCpf?: string;

  @ApiPropertyOptional({ description: 'Razão Social' })
  @IsString()
  @IsOptional()
  razaoSocial?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsString()
  @IsOptional()
  ie?: string;

  @ApiPropertyOptional({ description: 'Endereço completo' })
  @IsString()
  @IsOptional()
  endereco?: string;

  @ApiPropertyOptional({ description: 'Cidade' })
  @IsString()
  @IsOptional()
  cidade?: string;

  @ApiPropertyOptional({ description: 'UF' })
  @IsString()
  @IsOptional()
  uf?: string;
}

export class NfeVolumeDto {
  @ApiPropertyOptional({ description: 'Quantidade de volumes' })
  @IsNumber()
  @IsOptional()
  quantidade?: number;

  @ApiPropertyOptional({ description: 'Espécie dos volumes' })
  @IsString()
  @IsOptional()
  especie?: string;

  @ApiPropertyOptional({ description: 'Marca dos volumes' })
  @IsString()
  @IsOptional()
  marca?: string;

  @ApiPropertyOptional({ description: 'Numeração dos volumes' })
  @IsString()
  @IsOptional()
  numeracao?: string;

  @ApiPropertyOptional({ description: 'Peso Líquido' })
  @IsNumber()
  @IsOptional()
  pesoLiquido?: number;

  @ApiPropertyOptional({ description: 'Peso Bruto' })
  @IsNumber()
  @IsOptional()
  pesoBruto?: number;
}

export class NfePaymentDto {
  @ApiPropertyOptional({ description: 'Forma de pagamento (01, 02, etc)' })
  @IsString()
  @IsOptional()
  forma?: string;

  @ApiPropertyOptional({ description: 'Valor do pagamento' })
  @IsNumber()
  @IsOptional()
  valor?: number;
}

export class NfeDuplicateDto {
  @ApiPropertyOptional({ description: 'Número da duplicata' })
  @IsString()
  @IsOptional()
  numero?: string;

  @ApiPropertyOptional({ description: 'Data de vencimento (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  dataVencimento?: string;

  @ApiPropertyOptional({ description: 'Valor da duplicata' })
  @IsNumber()
  @IsOptional()
  valor?: number;
}

export class EmitNfeDto {
  @ApiPropertyOptional({ description: 'ID do orçamento' })
  @IsString()
  @IsOptional()
  quotationId?: string;

  @ApiPropertyOptional({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Natureza da operação' })
  @IsString()
  @IsOptional()
  operationNature?: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  additionalInfo?: string;

  @ApiPropertyOptional({
    description: 'Modalidade de frete: 0=CIF, 1=FOB, 9=Sem Frete, etc',
  })
  @IsInt()
  @IsOptional()
  modalidadeFrete?: number;

  @ApiPropertyOptional({ description: 'CNPJ/CPF do destinatário' })
  @IsString()
  @IsOptional()
  destCnpjCpf?: string;

  @ApiPropertyOptional({ description: 'Nome/Razão Social do destinatário' })
  @IsString()
  @IsOptional()
  destNome?: string;

  @ApiPropertyOptional({ description: 'IE do destinatário' })
  @IsString()
  @IsOptional()
  destIe?: string;

  @ApiPropertyOptional({ description: 'Email do destinatário' })
  @IsString()
  @IsOptional()
  destEmail?: string;

  @ApiPropertyOptional({ description: 'Endereço do destinatário' })
  @IsString()
  @IsOptional()
  destEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do endereço' })
  @IsString()
  @IsOptional()
  destNumero?: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  destComplemento?: string;

  @ApiPropertyOptional({ description: 'Bairro' })
  @IsString()
  @IsOptional()
  destBairro?: string;

  @ApiPropertyOptional({ description: 'CEP' })
  @IsString()
  @IsOptional()
  destCep?: string;

  @ApiPropertyOptional({ description: 'Código do município IBGE' })
  @IsString()
  @IsOptional()
  destCmun?: string;

  @ApiPropertyOptional({ description: 'Nome do município' })
  @IsString()
  @IsOptional()
  destMunicipio?: string;

  @ApiPropertyOptional({ description: 'UF' })
  @IsString()
  @IsOptional()
  destUf?: string;

  @ApiPropertyOptional({
    description: 'Código do país (padrão: 1058)',
    default: '1058',
  })
  @IsString()
  @IsOptional()
  destPais?: string;

  @ApiPropertyOptional({ description: 'Itens da NF-e', type: [NfeItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeItemDto)
  items?: NfeItemDto[];

  @ApiPropertyOptional({
    description: 'Dados da transportadora',
    type: NfeTransportDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NfeTransportDto)
  transportadora?: NfeTransportDto;

  @ApiPropertyOptional({
    description: 'Volumes transportados',
    type: [NfeVolumeDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeVolumeDto)
  volumes?: NfeVolumeDto[];

  @ApiPropertyOptional({
    description: 'Dados de pagamento',
    type: NfePaymentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NfePaymentDto)
  pagamento?: NfePaymentDto;

  @ApiPropertyOptional({ description: 'Duplicatas', type: [NfeDuplicateDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeDuplicateDto)
  duplicatas?: NfeDuplicateDto[];

  @ApiPropertyOptional({ description: 'CNPJ/CPFs autorizados a baixar o XML' })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  autXml?: string[];
}

export class CancelNfeDto {
  @ApiProperty({
    description: 'Justificativa do cancelamento (mín 15 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  justificativa: string;
}

export class CorrectionLetterDto {
  @ApiProperty({ description: 'Texto da correção (mín 15 caracteres)' })
  @IsString()
  @IsNotEmpty()
  correcao: string;

  @ApiPropertyOptional({
    description: 'Sequência do evento (1-20)',
    default: 1,
  })
  @IsInt()
  @IsOptional()
  sequenciaEvento?: number;
}

export class NfeFilterDto {
  @ApiPropertyOptional({ description: 'Status da NF-e', enum: NfeStatus })
  @IsEnum(NfeStatus)
  @IsOptional()
  status?: NfeStatus;

  @ApiPropertyOptional({ description: 'Data inicial' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Data final' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Número da NF-e' })
  @IsInt()
  @IsOptional()
  numero?: number;

  @ApiPropertyOptional({ description: 'ID da ordem' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Página', default: 1 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Itens por página', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

// DTO para dados do destinatário no rascunho
export class DraftDestinatarioDto {
  @ApiPropertyOptional({ description: 'Razão Social' })
  @IsString()
  @IsOptional()
  razaoSocial?: string;

  @ApiPropertyOptional({ description: 'CNPJ/CPF' })
  @IsString()
  @IsOptional()
  cnpjCpf?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsString()
  @IsOptional()
  ie?: string;

  @ApiPropertyOptional({ description: 'Email' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Telefone' })
  @IsString()
  @IsOptional()
  telefone?: string;

  @ApiPropertyOptional({ description: 'CEP' })
  @IsString()
  @IsOptional()
  cep?: string;

  @ApiPropertyOptional({ description: 'Estado' })
  @IsString()
  @IsOptional()
  estado?: string;

  @ApiPropertyOptional({ description: 'Cidade' })
  @IsString()
  @IsOptional()
  cidade?: string;

  @ApiPropertyOptional({ description: 'Bairro' })
  @IsString()
  @IsOptional()
  bairro?: string;

  @ApiPropertyOptional({ description: 'Endereço' })
  @IsString()
  @IsOptional()
  endereco?: string;

  @ApiPropertyOptional({ description: 'Número' })
  @IsString()
  @IsOptional()
  numero?: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  complemento?: string;

  @ApiPropertyOptional({ description: 'País' })
  @IsString()
  @IsOptional()
  pais?: string;
}

// DTO para atualizar rascunho
export class UpdateNfeDraftDto {
  @ApiPropertyOptional({
    description: 'Dados do destinatário',
    type: DraftDestinatarioDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DraftDestinatarioDto)
  destinatario?: DraftDestinatarioDto;

  @ApiPropertyOptional({ description: 'Itens da NF-e', type: [NfeItemDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeItemDto)
  items?: NfeItemDto[];

  @ApiPropertyOptional({
    description: 'Dados da transportadora',
    type: NfeTransportDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NfeTransportDto)
  transportadora?: NfeTransportDto;

  @ApiPropertyOptional({
    description: 'Volumes transportados',
    type: [NfeVolumeDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeVolumeDto)
  volumes?: NfeVolumeDto[];

  @ApiPropertyOptional({
    description: 'Dados de pagamento',
    type: NfePaymentDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NfePaymentDto)
  pagamento?: NfePaymentDto;

  @ApiPropertyOptional({ description: 'Duplicatas', type: [NfeDuplicateDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => NfeDuplicateDto)
  duplicatas?: NfeDuplicateDto[];

  @ApiPropertyOptional({ description: 'CNPJ/CPFs autorizados a baixar o XML' })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  autXml?: string[];

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  informacoesComplementares?: string;
}

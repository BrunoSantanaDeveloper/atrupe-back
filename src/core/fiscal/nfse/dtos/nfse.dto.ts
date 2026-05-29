import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  IsBoolean,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfseStatus } from '@prisma/client';

export class NfseItemDto {
  @ApiProperty({ description: 'Sequência do item' })
  @IsInt()
  @Min(1)
  seq: number;

  @ApiProperty({ description: 'Código do item' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ description: 'Descrição do serviço' })
  @IsString()
  @IsNotEmpty()
  descricao: string;

  @ApiProperty({ description: 'Quantidade' })
  @IsNumber()
  @Min(0.001)
  quantidade: number;

  @ApiProperty({ description: 'Valor unitário' })
  @IsNumber()
  @Min(0)
  valorUnitario: number;

  @ApiPropertyOptional({ description: 'Unidade de medida' })
  @IsString()
  @IsOptional()
  unidade?: string;

  @ApiPropertyOptional({ description: 'Código do serviço municipal' })
  @IsString()
  @IsOptional()
  codigoServico?: string;

  @ApiPropertyOptional({ description: 'Código CNAE' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiPropertyOptional({ description: 'Alíquota ISS' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;
}

export class TomadorDto {
  @ApiProperty({ description: 'CNPJ do tomador' })
  @IsString()
  @IsOptional()
  cnpj?: string;

  @ApiPropertyOptional({ description: 'CPF do tomador' })
  @IsString()
  @IsOptional()
  cpf?: string;

  @ApiProperty({ description: 'Razão Social' })
  @IsString()
  @IsNotEmpty()
  razaoSocial: string;

  @ApiPropertyOptional({ description: 'Inscrição Municipal' })
  @IsString()
  @IsOptional()
  inscricaoMunicipal?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsString()
  @IsOptional()
  inscricaoEstadual?: string;

  @ApiProperty({ description: 'Endereço' })
  @IsString()
  @IsNotEmpty()
  endereco: string;

  @ApiProperty({ description: 'Número' })
  @IsString()
  @IsNotEmpty()
  numero: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  complemento?: string;

  @ApiProperty({ description: 'Bairro' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  bairro: string;

  @ApiProperty({ description: 'CEP' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  cep: string;

  @ApiProperty({ description: 'Código do município IBGE' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  codigoMunicipio: string;

  @ApiProperty({ description: 'Nome do município' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  municipio: string;

  @ApiProperty({ description: 'UF' })
  @ValidateIf((o) => !o.codigoPais || o.codigoPais === '1058')
  @IsString()
  @IsNotEmpty()
  uf: string;

  @ApiPropertyOptional({ description: 'Email' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Telefone' })
  @IsString()
  @IsOptional()
  telefone?: string;

  @ApiPropertyOptional({ description: 'Código do país (padrão: 1058)' })
  @IsString()
  @IsOptional()
  codigoPais?: string;

  @ApiPropertyOptional({ description: 'Identificação estrangeiro' })
  @IsString()
  @IsOptional()
  idEstrangeiro?: string;
}

// DTO simplificado para emissão a partir de uma ordem
export class EmitNfseFromOrderDto {
  @ApiProperty({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Código do serviço municipal' })
  @IsString()
  @IsNotEmpty()
  codigoServico: string;

  @ApiProperty({ description: 'Discriminação do serviço' })
  @IsString()
  @IsNotEmpty()
  discriminacao: string;

  @ApiPropertyOptional({ description: 'Alíquota ISS (%)' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;

  @ApiPropertyOptional({ description: 'ID do endereço selecionado' })
  @IsString()
  @IsOptional()
  addressId?: string;
}

// DTO completo para emissão manual
export class EmitNfseDto {
  @ApiPropertyOptional({ description: 'ID do orçamento' })
  @IsString()
  @IsOptional()
  quotationId?: string;

  @ApiPropertyOptional({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Data de competência' })
  @IsString()
  @IsOptional()
  dataCompetencia?: string;

  @ApiProperty({ description: 'Natureza da operação' })
  @IsInt()
  @IsNotEmpty()
  naturezaOperacao: number; // 1 = Tributação no município, etc.

  @ApiPropertyOptional({ description: 'Regime especial de tributação' })
  @IsInt()
  @IsOptional()
  regimeEspecial?: number;

  @ApiPropertyOptional({ description: 'Optante Simples Nacional' })
  @IsInt()
  @IsOptional()
  optanteSimplesNacional?: number; // 1 = Sim, 2 = Não

  @ApiPropertyOptional({ description: 'Incentivador cultural' })
  @IsInt()
  @IsOptional()
  incentivadorCultural?: number; // 1 = Sim, 2 = Não

  @ApiProperty({ description: 'Código do serviço municipal' })
  @IsString()
  @IsNotEmpty()
  codigoServico: string;

  @ApiPropertyOptional({ description: 'Código CNAE' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiProperty({ description: 'Discriminação do serviço' })
  @IsString()
  @IsNotEmpty()
  discriminacao: string;

  @ApiProperty({ description: 'Código do município de prestação' })
  @IsString()
  @IsNotEmpty()
  codigoMunicipio: string;

  @ApiProperty({ description: 'Valor dos serviços' })
  @IsNumber()
  @Min(0)
  valorServicos: number;

  @ApiPropertyOptional({ description: 'Valor das deduções' })
  @IsNumber()
  @IsOptional()
  valorDeducoes?: number;

  @ApiPropertyOptional({ description: 'Alíquota ISS' })
  @IsNumber()
  @IsOptional()
  aliquotaIss?: number;

  @ApiPropertyOptional({ description: 'ISS Retido' })
  @IsBoolean()
  @IsOptional()
  issRetido?: boolean;

  @ApiPropertyOptional({ description: 'Alíquota PIS' })
  @IsNumber()
  @IsOptional()
  aliquotaPis?: number;

  @ApiPropertyOptional({ description: 'Valor PIS' })
  @IsNumber()
  @IsOptional()
  valorPis?: number;

  @ApiPropertyOptional({ description: 'Alíquota COFINS' })
  @IsNumber()
  @IsOptional()
  aliquotaCofins?: number;

  @ApiPropertyOptional({ description: 'Valor COFINS' })
  @IsNumber()
  @IsOptional()
  valorCofins?: number;

  @ApiPropertyOptional({ description: 'Alíquota INSS' })
  @IsNumber()
  @IsOptional()
  aliquotaInss?: number;

  @ApiPropertyOptional({ description: 'Valor INSS' })
  @IsNumber()
  @IsOptional()
  valorInss?: number;

  @ApiPropertyOptional({ description: 'Alíquota IR' })
  @IsNumber()
  @IsOptional()
  aliquotaIr?: number;

  @ApiPropertyOptional({ description: 'Valor IR' })
  @IsNumber()
  @IsOptional()
  valorIr?: number;

  @ApiPropertyOptional({ description: 'Alíquota CSLL' })
  @IsNumber()
  @IsOptional()
  aliquotaCsll?: number;

  @ApiPropertyOptional({ description: 'Valor CSLL' })
  @IsNumber()
  @IsOptional()
  valorCsll?: number;

  @ApiProperty({ description: 'Dados do tomador', type: TomadorDto })
  @ValidateNested()
  @Type(() => TomadorDto)
  tomador: TomadorDto;

  @ApiPropertyOptional({ description: 'Itens do serviço', type: [NfseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NfseItemDto)
  @IsOptional()
  itens?: NfseItemDto[];
}

export class CancelNfseDto {
  @ApiProperty({
    description: 'Justificativa do cancelamento (mín 15 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  justificativa: string;

  @ApiPropertyOptional({ description: 'Código do cancelamento' })
  @IsString()
  @IsOptional()
  codigoCancelamento?: string;
}

export class NfseFilterDto {
  @ApiPropertyOptional({ description: 'Status da NFS-e', enum: NfseStatus })
  @IsEnum(NfseStatus)
  @IsOptional()
  status?: NfseStatus;

  @ApiPropertyOptional({ description: 'Data inicial' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Data final' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Número da NFS-e' })
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
  page?: number;

  @ApiPropertyOptional({ description: 'Itens por página', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;
}

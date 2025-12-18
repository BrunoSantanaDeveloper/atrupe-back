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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NfceStatus } from '@prisma/client';

export class NfceItemDto {
  @ApiProperty({ description: 'ID do produto' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({ description: 'Código do produto' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ description: 'Descrição do produto' })
  @IsString()
  @IsNotEmpty()
  descricao: string;

  @ApiProperty({ description: 'NCM' })
  @IsString()
  @IsNotEmpty()
  ncm: string;

  @ApiPropertyOptional({ description: 'CEST' })
  @IsString()
  @IsOptional()
  cest?: string;

  @ApiProperty({ description: 'CFOP' })
  @IsString()
  @IsNotEmpty()
  cfop: string;

  @ApiProperty({ description: 'Unidade comercial' })
  @IsString()
  @IsNotEmpty()
  unidade: string;

  @ApiProperty({ description: 'Quantidade' })
  @IsNumber()
  @Min(0.001)
  quantidade: number;

  @ApiProperty({ description: 'Valor unitário' })
  @IsNumber()
  @Min(0)
  valorUnitario: number;

  @ApiPropertyOptional({ description: 'Valor desconto' })
  @IsNumber()
  @IsOptional()
  valorDesconto?: number;

  @ApiPropertyOptional({ description: 'Código de barras (GTIN)' })
  @IsString()
  @IsOptional()
  cean?: string;

  @ApiPropertyOptional({ description: 'Origem do ICMS' })
  @IsString()
  @IsOptional()
  icmsOrigem?: string;

  @ApiPropertyOptional({ description: 'CST/CSOSN ICMS' })
  @IsString()
  @IsOptional()
  icmsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota ICMS' })
  @IsNumber()
  @IsOptional()
  icmsAliquota?: number;

  @ApiPropertyOptional({ description: 'CST PIS' })
  @IsString()
  @IsOptional()
  pisCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota PIS' })
  @IsNumber()
  @IsOptional()
  pisAliquota?: number;

  @ApiPropertyOptional({ description: 'CST COFINS' })
  @IsString()
  @IsOptional()
  cofinsCst?: string;

  @ApiPropertyOptional({ description: 'Alíquota COFINS' })
  @IsNumber()
  @IsOptional()
  cofinsAliquota?: number;
}

export class PagamentoDto {
  @ApiProperty({
    description:
      'Forma de pagamento (01=Dinheiro, 02=Cheque, 03=Cartão Crédito, etc.)',
  })
  @IsString()
  @IsNotEmpty()
  tipo: string;

  @ApiProperty({ description: 'Valor do pagamento' })
  @IsNumber()
  @Min(0)
  valor: number;

  @ApiPropertyOptional({ description: 'Bandeira do cartão' })
  @IsString()
  @IsOptional()
  bandeira?: string;

  @ApiPropertyOptional({ description: 'CNPJ da credenciadora' })
  @IsString()
  @IsOptional()
  cnpjCredenciadora?: string;

  @ApiPropertyOptional({ description: 'Número de autorização' })
  @IsString()
  @IsOptional()
  autorizacao?: string;
}

export class EmitNfceDto {
  @ApiPropertyOptional({ description: 'ID do orçamento' })
  @IsString()
  @IsOptional()
  quotationId?: string;

  @ApiPropertyOptional({ description: 'ID da ordem de serviço' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'CPF do consumidor' })
  @IsString()
  @IsOptional()
  cpfConsumidor?: string;

  @ApiPropertyOptional({ description: 'Nome do consumidor' })
  @IsString()
  @IsOptional()
  nomeConsumidor?: string;

  @ApiProperty({ description: 'Natureza da operação' })
  @IsString()
  @IsNotEmpty()
  naturezaOperacao: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  informacoesComplementares?: string;

  @ApiProperty({ description: 'Itens da NFC-e', type: [NfceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NfceItemDto)
  itens: NfceItemDto[];

  @ApiProperty({ description: 'Formas de pagamento', type: [PagamentoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagamentoDto)
  pagamentos: PagamentoDto[];

  @ApiPropertyOptional({ description: 'Valor do troco' })
  @IsNumber()
  @IsOptional()
  valorTroco?: number;
}

export class CancelNfceDto {
  @ApiProperty({
    description: 'Justificativa do cancelamento (mín 15 caracteres)',
  })
  @IsString()
  @IsNotEmpty()
  justificativa: string;
}

export class InutilizarNfceDto {
  @ApiProperty({ description: 'Número inicial' })
  @IsInt()
  @Min(1)
  numeroInicial: number;

  @ApiProperty({ description: 'Número final' })
  @IsInt()
  @Min(1)
  numeroFinal: number;

  @ApiProperty({ description: 'Justificativa (mín 15 caracteres)' })
  @IsString()
  @IsNotEmpty()
  justificativa: string;
}

export class ContingenciaNfceDto {
  @ApiProperty({ description: 'Motivo da contingência' })
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @ApiPropertyOptional({ description: 'Ativar contingência' })
  @IsBoolean()
  @IsOptional()
  ativar?: boolean;
}

export class NfceFilterDto {
  @ApiPropertyOptional({ description: 'Status da NFC-e', enum: NfceStatus })
  @IsEnum(NfceStatus)
  @IsOptional()
  status?: NfceStatus;

  @ApiPropertyOptional({ description: 'Data inicial' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Data final' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Número da NFC-e' })
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

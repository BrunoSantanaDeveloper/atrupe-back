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

  @ApiProperty({ description: 'Natureza da operação' })
  @IsString()
  @IsNotEmpty()
  operationNature: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  additionalInfo?: string;

  @ApiProperty({ description: 'CNPJ/CPF do destinatário' })
  @IsString()
  @IsNotEmpty()
  destCnpjCpf: string;

  @ApiProperty({ description: 'Nome/Razão Social do destinatário' })
  @IsString()
  @IsNotEmpty()
  destNome: string;

  @ApiPropertyOptional({ description: 'IE do destinatário' })
  @IsString()
  @IsOptional()
  destIe?: string;

  @ApiPropertyOptional({ description: 'Email do destinatário' })
  @IsString()
  @IsOptional()
  destEmail?: string;

  @ApiProperty({ description: 'Endereço do destinatário' })
  @IsString()
  @IsNotEmpty()
  destEndereco: string;

  @ApiProperty({ description: 'Número do endereço' })
  @IsString()
  @IsNotEmpty()
  destNumero: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  destComplemento?: string;

  @ApiProperty({ description: 'Bairro' })
  @IsString()
  @IsNotEmpty()
  destBairro: string;

  @ApiProperty({ description: 'CEP' })
  @IsString()
  @IsNotEmpty()
  destCep: string;

  @ApiProperty({ description: 'Código do município IBGE' })
  @IsString()
  @IsNotEmpty()
  destCmun: string;

  @ApiProperty({ description: 'Nome do município' })
  @IsString()
  @IsNotEmpty()
  destMunicipio: string;

  @ApiProperty({ description: 'UF' })
  @IsString()
  @IsNotEmpty()
  destUf: string;

  @ApiPropertyOptional({
    description: 'Código do país (padrão: 1058)',
    default: '1058',
  })
  @IsString()
  @IsOptional()
  destPais?: string;

  @ApiProperty({ description: 'Itens da NF-e', type: [NfeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NfeItemDto)
  items: NfeItemDto[];
}

export class CancelNfeDto {
  @ApiProperty({ description: 'Justificativa do cancelamento (mín 15 caracteres)' })
  @IsString()
  @IsNotEmpty()
  justificativa: string;
}

export class CorrectionLetterDto {
  @ApiProperty({ description: 'Texto da correção (mín 15 caracteres)' })
  @IsString()
  @IsNotEmpty()
  correcao: string;
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
  page?: number;

  @ApiPropertyOptional({ description: 'Itens por página', default: 20 })
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;
}

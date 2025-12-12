import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvoicyConfigDto {
  @ApiProperty({ description: 'Token da API do Invoicy' })
  @IsString()
  @IsNotEmpty()
  apiToken: string;

  @ApiPropertyOptional({
    description: 'Ambiente: 1 = Produção, 2 = Homologação',
    default: 2,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2)
  ambiente?: number;

  @ApiProperty({ description: 'CNPJ do emitente' })
  @IsString()
  @IsNotEmpty()
  emitCnpj: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual do emitente' })
  @IsString()
  @IsOptional()
  emitIe?: string;

  @ApiProperty({ description: 'Razão Social do emitente' })
  @IsString()
  @IsNotEmpty()
  emitRazaoSocial: string;

  @ApiPropertyOptional({ description: 'Nome Fantasia do emitente' })
  @IsString()
  @IsOptional()
  emitNomeFantasia?: string;

  @ApiPropertyOptional({
    description: 'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal',
    default: 1,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3)
  emitCrt?: number;

  @ApiPropertyOptional({ description: 'Endereço do emitente' })
  @IsString()
  @IsOptional()
  emitEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do endereço' })
  @IsString()
  @IsOptional()
  emitNumero?: string;

  @ApiPropertyOptional({ description: 'Bairro do emitente' })
  @IsString()
  @IsOptional()
  emitBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do emitente' })
  @IsString()
  @IsOptional()
  emitCep?: string;

  @ApiPropertyOptional({ description: 'Código do município IBGE' })
  @IsString()
  @IsOptional()
  emitCmun?: string;

  @ApiPropertyOptional({ description: 'UF do emitente' })
  @IsString()
  @IsOptional()
  emitUf?: string;

  @ApiPropertyOptional({
    description: 'Código do país (padrão: 1058 = Brasil)',
    default: '1058',
  })
  @IsString()
  @IsOptional()
  emitPais?: string;

  @ApiPropertyOptional({ description: 'Série da NF-e', default: 1 })
  @IsInt()
  @IsOptional()
  @Min(1)
  serieNfe?: number;

  @ApiPropertyOptional({
    description: 'Próximo número da NF-e',
    default: 1,
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  proximoNumeroNfe?: number;
}

export class UpdateInvoicyConfigDto {
  @ApiPropertyOptional({ description: 'Token da API do Invoicy' })
  @IsString()
  @IsOptional()
  apiToken?: string;

  @ApiPropertyOptional({
    description: 'Ambiente: 1 = Produção, 2 = Homologação',
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2)
  ambiente?: number;

  @ApiPropertyOptional({ description: 'CNPJ do emitente' })
  @IsString()
  @IsOptional()
  emitCnpj?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual do emitente' })
  @IsString()
  @IsOptional()
  emitIe?: string;

  @ApiPropertyOptional({ description: 'Razão Social do emitente' })
  @IsString()
  @IsOptional()
  emitRazaoSocial?: string;

  @ApiPropertyOptional({ description: 'Nome Fantasia do emitente' })
  @IsString()
  @IsOptional()
  emitNomeFantasia?: string;

  @ApiPropertyOptional({
    description: 'CRT: 1 = Simples Nacional, 2 = SN Excesso, 3 = Regime Normal',
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(3)
  emitCrt?: number;

  @ApiPropertyOptional({ description: 'Endereço do emitente' })
  @IsString()
  @IsOptional()
  emitEndereco?: string;

  @ApiPropertyOptional({ description: 'Número do endereço' })
  @IsString()
  @IsOptional()
  emitNumero?: string;

  @ApiPropertyOptional({ description: 'Bairro do emitente' })
  @IsString()
  @IsOptional()
  emitBairro?: string;

  @ApiPropertyOptional({ description: 'CEP do emitente' })
  @IsString()
  @IsOptional()
  emitCep?: string;

  @ApiPropertyOptional({ description: 'Código do município IBGE' })
  @IsString()
  @IsOptional()
  emitCmun?: string;

  @ApiPropertyOptional({ description: 'UF do emitente' })
  @IsString()
  @IsOptional()
  emitUf?: string;

  @ApiPropertyOptional({ description: 'Código do país' })
  @IsString()
  @IsOptional()
  emitPais?: string;

  @ApiPropertyOptional({ description: 'Série da NF-e' })
  @IsInt()
  @IsOptional()
  @Min(1)
  serieNfe?: number;

  @ApiPropertyOptional({ description: 'Próximo número da NF-e' })
  @IsInt()
  @IsOptional()
  @Min(1)
  proximoNumeroNfe?: number;

  @ApiPropertyOptional({ description: 'Configuração ativa' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

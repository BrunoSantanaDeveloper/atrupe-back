import { IsString, IsNotEmpty, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum InvoicyEnvironment {
  HOMOLOGACAO = 'HOMOLOGACAO',
  PRODUCAO = 'PRODUCAO',
}

export class CreateInvoicyConfigDto {
  @ApiProperty({
    description: 'Chave de Parceiro Invoicy',
    example: 'EIqPbfmvrfy88W+PHslzMA==',
  })
  @IsString()
  @IsNotEmpty()
  partnerKey: string;

  @ApiProperty({
    description: 'Chave de Acesso Invoicy',
    example: 'FT5LiauxnDHZ8nsqE+Ce00i1+xxb0hMv',
  })
  @IsString()
  @IsNotEmpty()
  accessKey: string;

  @ApiProperty({
    description: 'Ambiente (HOMOLOGACAO ou PRODUCAO)',
    enum: InvoicyEnvironment,
    default: InvoicyEnvironment.HOMOLOGACAO,
  })
  @IsEnum(InvoicyEnvironment)
  @IsOptional()
  environment?: InvoicyEnvironment;

  @ApiProperty({ description: 'Série da NF-e', example: '1', required: false })
  @IsString()
  @IsOptional()
  nfeSeries?: string;

  @ApiProperty({ description: 'Próximo número NF-e', example: 1, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  nfeNextNumber?: number;

  @ApiProperty({ description: 'Série da NFC-e', example: '1', required: false })
  @IsString()
  @IsOptional()
  nfceSeries?: string;

  @ApiProperty({ description: 'Próximo número NFC-e', example: 1, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  nfceNextNumber?: number;

  @ApiProperty({ description: 'CFOP padrão', example: '5102', required: false })
  @IsString()
  @IsOptional()
  defaultCfop?: string;

  @ApiProperty({
    description: 'Natureza da operação padrão',
    example: 'Venda de mercadoria',
    required: false,
  })
  @IsString()
  @IsOptional()
  defaultOperationNature?: string;

  @ApiProperty({
    description: 'Texto de informações fiscais padrão',
    required: false,
  })
  @IsString()
  @IsOptional()
  taxInfoText?: string;
}

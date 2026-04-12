import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  Length,
  Matches,
} from 'class-validator';

export class FiscalOnboardingDto {
  @ApiProperty({ description: 'CNPJ da empresa (14 dígitos)' })
  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @ApiProperty({ description: 'Razão Social' })
  @IsString()
  @IsNotEmpty()
  razaoSocial: string;

  @ApiPropertyOptional({ description: 'Nome Fantasia' })
  @IsString()
  @IsOptional()
  nomeFantasia?: string;

  @ApiPropertyOptional({ description: 'Inscrição Estadual' })
  @IsString()
  @IsOptional()
  ie?: string;

  @ApiPropertyOptional({ description: 'Inscrição Municipal' })
  @IsString()
  @IsOptional()
  im?: string;

  @ApiPropertyOptional({ description: 'CNAE' })
  @IsString()
  @IsOptional()
  cnae?: string;

  @ApiProperty({ description: 'UF (2 caracteres)', example: 'SC' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 2)
  uf: string;

  @ApiPropertyOptional({ description: 'Código IBGE do município' })
  @IsString()
  @IsOptional()
  codigoIbge?: string;

  @ApiPropertyOptional({ description: 'CEP' })
  @IsString()
  @IsOptional()
  cep?: string;

  @ApiPropertyOptional({ description: 'Logradouro' })
  @IsString()
  @IsOptional()
  logradouro?: string;

  @ApiPropertyOptional({ description: 'Número' })
  @IsString()
  @IsOptional()
  numero?: string;

  @ApiPropertyOptional({ description: 'Bairro' })
  @IsString()
  @IsOptional()
  bairro?: string;

  @ApiPropertyOptional({ description: 'Cidade' })
  @IsString()
  @IsOptional()
  cidade?: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @IsString()
  @IsOptional()
  complemento?: string;

  @ApiPropertyOptional({
    description: 'Certificado digital em base64 (.pfx)',
  })
  @IsString()
  @IsOptional()
  certificate?: string;

  @ApiPropertyOptional({ description: 'Senha do certificado digital' })
  @IsString()
  @IsOptional()
  certificatePassword?: string;

  @ApiPropertyOptional({
    description: 'Tipo do certificado',
    enum: ['A1', 'A3'],
  })
  @IsString()
  @IsOptional()
  @Matches(/^(A1|A3)$/)
  certificateType?: string;
}

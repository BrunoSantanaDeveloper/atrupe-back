import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOperationNatureDto {
  @ApiProperty({ description: 'Descrição da Natureza de Operação' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Tipo: ENTRADA ou SAIDA',
    enum: ['ENTRADA', 'SAIDA'],
  })
  @IsEnum(['ENTRADA', 'SAIDA'])
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'Finalidade da emissão' })
  @IsString()
  @IsNotEmpty()
  finality: string;

  @ApiProperty({ description: 'Presença do consumidor' })
  @IsString()
  @IsNotEmpty()
  consumerPresence: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  info?: string;

  @ApiPropertyOptional({ description: 'ID do CFOP para dentro do estado' })
  @IsString()
  @IsOptional()
  cfopInternalId?: string;

  @ApiPropertyOptional({ description: 'ID do CFOP para fora do estado' })
  @IsString()
  @IsOptional()
  cfopExternalId?: string;

  @ApiPropertyOptional({
    description: 'Se a natureza está ativa',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateOperationNatureDto {
  @ApiPropertyOptional({ description: 'Descrição da Natureza de Operação' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Tipo: ENTRADA ou SAIDA',
    enum: ['ENTRADA', 'SAIDA'],
  })
  @IsEnum(['ENTRADA', 'SAIDA'])
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ description: 'Finalidade da emissão' })
  @IsString()
  @IsOptional()
  finality?: string;

  @ApiPropertyOptional({ description: 'Presença do consumidor' })
  @IsString()
  @IsOptional()
  consumerPresence?: string;

  @ApiPropertyOptional({ description: 'Informações complementares' })
  @IsString()
  @IsOptional()
  info?: string;

  @ApiPropertyOptional({ description: 'ID do CFOP para dentro do estado' })
  @IsString()
  @IsOptional()
  cfopInternalId?: string;

  @ApiPropertyOptional({ description: 'ID do CFOP para fora do estado' })
  @IsString()
  @IsOptional()
  cfopExternalId?: string;

  @ApiPropertyOptional({ description: 'Se a natureza está ativa' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CfopType {
  ENTRADA = 'ENTRADA',
  SAIDA = 'SAIDA',
}

export class CreateCfopDto {
  @ApiProperty({ description: 'Código CFOP (ex: "5102")' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: 'Descrição do CFOP' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Tipo: ENTRADA ou SAIDA',
    enum: CfopType,
  })
  @IsEnum(CfopType)
  @IsNotEmpty()
  type: CfopType;

  @ApiPropertyOptional({ description: 'Natureza da operação' })
  @IsString()
  @IsOptional()
  nature?: string;

  @ApiPropertyOptional({ description: 'Informações de uso' })
  @IsString()
  @IsOptional()
  info?: string;

  @ApiPropertyOptional({ description: 'Se o CFOP está ativo', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCfopDto {
  @ApiPropertyOptional({ description: 'Código CFOP (ex: "5102")' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Descrição do CFOP' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Tipo: ENTRADA ou SAIDA',
    enum: CfopType,
  })
  @IsEnum(CfopType)
  @IsOptional()
  type?: CfopType;

  @ApiPropertyOptional({ description: 'Natureza da operação' })
  @IsString()
  @IsOptional()
  nature?: string;

  @ApiPropertyOptional({ description: 'Informações de uso' })
  @IsString()
  @IsOptional()
  info?: string;

  @ApiPropertyOptional({ description: 'Se o CFOP está ativo' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  BiilingKind,
  ProductionStatusKind,
  SendToProductionKind,
} from '@prisma/client';
import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  IsUUID,
} from 'class-validator';

export class UpdateSaleSeriesDto {
  @ApiProperty({
    description: 'Código único da série de vendas.',
    example: 'T1',
  })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiProperty({
    description: 'Descrição da série de vendas.',
    example: 'Treinamento',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Título da série de vendas.',
    example: 'Orçamento',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Validade da proposta em dias.',
    example: 6,
  })
  @IsInt()
  @IsOptional()
  proposalValidity?: number;

  @ApiProperty({
    description: 'Prazo de entrega em dias.',
    example: 6,
  })
  @IsInt()
  @IsOptional()
  deliveryDeadline?: number;

  @ApiProperty({
    description: 'Informação de faturamento.',
    example: 'ON_ORDER',
  })
  @IsEnum(BiilingKind)
  @IsOptional()
  billing?: BiilingKind;

  @ApiProperty({
    description: 'Opção de envio para produção.',
    example: 'DIRECT',
  })
  @IsEnum(SendToProductionKind)
  @IsOptional()
  sendToProduction?: SendToProductionKind;

  @ApiProperty({
    description: 'Status de produção.',
    example: 'MANAGE_PRODUCTION',
  })
  @IsEnum(ProductionStatusKind)
  @IsOptional()
  productionStatus?: ProductionStatusKind;

  @ApiProperty({
    description: 'Indica se a série está ativa.',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    description: 'Indica se a série é padrão.',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiProperty({
    description:
      'IDs dos perfis de vendedor que podem usar esta série. Vazio = disponível para todos.',
    type: [String],
    required: false,
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  allowedProfileIds?: string[];
}

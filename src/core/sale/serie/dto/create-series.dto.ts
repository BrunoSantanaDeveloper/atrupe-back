import { ApiProperty } from '@nestjs/swagger';
import {
  BiilingKind,
  ProductionStatusKind,
  SendToProductionKind,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsString, IsInt, IsOptional, IsEnum } from 'class-validator';
import { blankProposalTextToNull } from './proposal-text';

export class CreateSaleSeriesDto {
  @ApiProperty({
    description: 'Código único da série de vendas.',
    example: 'T1',
  })
  @IsString()
  code: string;

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
  title: string;

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
    description:
      'Texto da proposta comercial antes dos itens. Em branco, vale o texto da empresa.',
    example: 'Segue abaixo conforme sua solicitação:',
    required: false,
    nullable: true,
  })
  @Transform(blankProposalTextToNull)
  @IsString()
  @IsOptional()
  textBeforeItems?: string | null;

  @ApiProperty({
    description:
      'Texto da proposta comercial depois dos itens. Em branco, vale o texto da empresa.',
    example: '1) Crédito e condição de pagamento sujeito à aprovação;',
    required: false,
    nullable: true,
  })
  @Transform(blankProposalTextToNull)
  @IsString()
  @IsOptional()
  textAfterItems?: string | null;

  isActive?: boolean;

  companyId: string;
}

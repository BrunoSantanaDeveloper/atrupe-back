import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingType } from '@prisma/client';

export class CreatePaymentDto {
  @ApiPropertyOptional({
    description: 'ID da subscription relacionada',
    example: 'uuid-subscription',
  })
  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @ApiProperty({
    description: 'ID do customer no Asaas',
    example: 'cus_000005735417',
  })
  @IsString()
  asaasCustomerId: string;

  @ApiProperty({
    description: 'Valor da cobrança',
    example: 99.9,
  })
  @IsNumber()
  value: number;

  @ApiProperty({
    description: 'Data de vencimento',
    example: '2025-11-21',
  })
  @IsDateString()
  dueDate: string;

  @ApiProperty({
    enum: BillingType,
    description: 'Forma de pagamento',
    example: 'CREDIT_CARD',
  })
  @IsEnum(BillingType)
  billingType: BillingType;

  @ApiPropertyOptional({
    description: 'Descrição da cobrança',
    example: 'Primeira cobrança - Plano PRO',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Referência externa (ex: ID da subscription)',
    example: 'subscription-uuid',
  })
  @IsString()
  @IsOptional()
  externalReference?: string;

  @ApiPropertyOptional({
    description: 'URL de sucesso após pagamento',
    example: 'https://atrupe.com.br/payment/success',
  })
  @IsString()
  @IsOptional()
  successUrl?: string;
}

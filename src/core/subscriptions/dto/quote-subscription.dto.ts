import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BillingType } from '@prisma/client';
import {
  CARD_MAX_INSTALLMENTS,
  MAX_ADDITIONAL_USERS,
} from '../pricing/pricing.engine';

/**
 * Pedido de orçamento da contratação. Não cria nada: devolve o que seria
 * cobrado, calculado pelo mesmo motor que a contratação usa.
 */
export class QuoteSubscriptionDto {
  @ApiProperty()
  @IsString()
  planId: string;

  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], required: false })
  @IsOptional()
  @IsEnum(['MONTHLY', 'YEARLY'])
  cycle?: 'MONTHLY' | 'YEARLY';

  @ApiProperty({ enum: BillingType, required: false })
  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

  @ApiProperty({ required: false, description: 'Só no anual, no cartão' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CARD_MAX_INSTALLMENTS)
  installmentCount?: number;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Chaves dos módulos pagos (ex.: nota_fiscal)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADDITIONAL_USERS)
  additionalUsers?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  couponCode?: string;
}

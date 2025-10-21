import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateCustomerDto } from 'src/core/customers/dto/create-customer.dto';
import { Type } from 'class-transformer';
import { Cycle } from '@prisma/client';
import { BillingType } from '@prisma/client';

export class CreateSubscriptionDto {
  @ApiProperty({ type: () => CreateCustomerDto })
  @ValidateNested()
  @Type(() => CreateCustomerDto)
  customer: CreateCustomerDto;

  @ApiProperty()
  @IsString()
  planId: string;

  @ApiProperty({ description: 'Número de usuários adicionais' })
  @IsNumber()
  @IsOptional()
  additionalUsers?: number = 0;

  @ApiProperty({ enum: BillingType })
  @IsEnum(BillingType)
  billingType: BillingType;

  @ApiProperty({ enum: Cycle })
  @IsEnum(Cycle)
  cycle: Cycle;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Features adicionais além das inclusas no plano',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalFeatures?: string[];

  @ApiProperty({
    required: false,
    description: 'URL de retorno após pagamento bem-sucedido',
    example: 'https://atrupe.com.br/payment/success',
  })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiProperty({
    required: false,
    description: 'URL de retorno após pagamento falhar',
    example: 'https://atrupe.com.br/payment/failure',
  })
  @IsOptional()
  @IsString()
  failureUrl?: string;
}

import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
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
  // Inteiro e não negativo: com @IsNumber() sozinho, um valor negativo passava
  // e ABATIA do preço, porque o total soma additionalUsers × preço unitário.
  @IsInt()
  @Min(0)
  @Max(20)
  @IsOptional()
  additionalUsers?: number = 0;

  @ApiProperty({ enum: BillingType })
  @IsEnum(BillingType)
  billingType: BillingType;

  @ApiProperty({ enum: Cycle })
  @IsEnum(Cycle)
  @IsOptional()
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

  @ApiProperty({
    required: false,
    description: 'Código do cupom de desconto a ser aplicado',
    example: 'BEMVINDO20',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;

  companyId?: string;
}

import { PaymentConditionCostType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InstallmentDto {
  @IsNumberString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Número da parcela',
    example: 1,
  })
  installment: number;

  @IsNotEmpty()
  @IsNumberString()
  @ApiProperty({
    description: 'Taxa de operador para a parcela',
    example: 2.5,
  })
  operatorFeeRate: number;

  @IsOptional()
  @IsNumberString()
  @ApiProperty({
    description: 'Taxa de transferência do operador para a parcela',
    example: 1.0,
    required: false,
  })
  operatorFeeTransfer: number;
}

export class CreateConditionDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da condição de pagamento',
    example: 'Condição de Exemplo',
  })
  name: string;

  @IsNotEmpty()
  @IsBoolean()
  @ApiProperty({
    description: 'Indica se aceita parcelas',
    example: true,
  })
  acceptInstallments: boolean;

  @IsNotEmpty()
  @IsEnum(PaymentConditionCostType)
  @ApiProperty({
    description: 'Tipo de custo da condição de pagamento',
    example: PaymentConditionCostType.PERCENT,
    enum: PaymentConditionCostType,
  })
  costType: PaymentConditionCostType;

  @ValidateIf((o) => o.acceptInstallments === false)
  @IsNotEmpty()
  @IsNumberString()
  @ApiProperty({
    description: 'Taxa de operador quando não aceita parcelas',
    example: 2.5,
    required: false,
  })
  operatorFeeRate: number;

  @ValidateIf((o) => o.acceptInstallments === false)
  @IsOptional()
  @IsNumberString()
  @ApiProperty({
    description: 'Taxa de transferência do operador quando não aceita parcelas',
    example: 1.0,
    required: false,
  })
  operatorFeeTransfer: number;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do método de pagamento associado',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  paymentMethodId: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à condição de pagamento',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  companyId: string;

  @ValidateIf((o) => o.acceptInstallments === true)
  @IsNumberString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Número mínimo de parcelas',
    example: 2,
    required: false,
  })
  minInstallments?: number;

  @ValidateIf((o) => o.acceptInstallments === true)
  @IsNumberString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Número máximo de parcelas',
    example: 12,
    required: false,
  })
  maxInstallments?: number;

  @ValidateIf((o) => o.acceptInstallments === true)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  @ApiProperty({
    description: 'Detalhes das parcelas',
    type: [InstallmentDto],
    required: false,
  })
  installments: InstallmentDto[];
}

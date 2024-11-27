import { PaymentConditionCostType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InstallmentDto {
  @IsNumber()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Número da parcela',
    example: 1,
  })
  installment: number;

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({
    description: 'Taxa de operador para a parcela',
    example: 2.5,
  })
  operatorFeeRate: number;

  @IsOptional()
  @IsNumber()
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

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do método de pagamento associado',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  paymentMethodId: string;

  // @IsNotEmpty()
  // @IsUUID()
  // @ApiProperty({
  //   description: 'ID da empresa associada à condição de pagamento',
  //   example: '123e4567-e89b-12d3-a456-426614174001',
  // })
  companyId: string;
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Nome da condição de recebimento',
    example: 'A vista',
  })
  receivingType: string;
  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Quantidade de dias de intervalo de recebimento',
    example: 'A vista',
  })
  dayInterval: number;

  @ValidateIf((o) => o.acceptInstallments === true)
  @IsNumber()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Número mínimo de parcelas',
    example: 2,
    required: false,
  })
  minInstallments?: number;

  @ValidateIf((o) => o.acceptInstallments === true)
  @IsNumber()
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

import { BankAccountCashControlType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BankAccountCashControlDto {
  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Indica se aceita pagamentos',
    example: true,
    required: false,
  })
  acceptPayments: boolean;

  @IsOptional()
  @IsEnum(BankAccountCashControlType)
  @ApiProperty({
    description: 'Tipo de controle de caixa para pagamentos',
    example: BankAccountCashControlType.PROVISION,
    enum: BankAccountCashControlType,
    required: false,
  })
  paymentType: BankAccountCashControlType;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Indica se aceita rendimentos',
    example: true,
    required: false,
  })
  acceptIncomes: boolean;

  @IsOptional()
  @IsEnum(BankAccountCashControlType)
  @ApiProperty({
    description: 'Tipo de controle de caixa para rendimentos',
    example: BankAccountCashControlType.PAYSOFF,
    enum: BankAccountCashControlType,
    required: false,
  })
  incomeType: BankAccountCashControlType;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do método de pagamento associado',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  paymentMethodId: string;
}

export class CreateBankAccountDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da conta bancária',
    example: 'Conta Corrente Principal',
  })
  name: string;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID do banco associado',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  bankId: string;

  companyId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição da conta bancária',
    example: 'Conta utilizada para operações principais',
    required: false,
  })
  description: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Indica se a conta tem controle de caixa',
    example: true,
    required: false,
  })
  cashControl: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BankAccountCashControlDto)
  @ApiProperty({
    description: 'Detalhes do controle de caixa da conta bancária',
    type: [BankAccountCashControlDto],
    required: false,
  })
  bankAccountCashControl?: BankAccountCashControlDto[];
}

import { BankAccountCashControlType, BankAccountKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BankAccountCashControlDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do controle de caixa (obrigatório para atualização)',
    example: '123e4567-e89b-12d3-a456-426614174002',
    required: false,
  })
  id?: string;

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
    description: 'ID da condição de pagamento associada',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  paymentConditionId: string;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description:
      'A conta que vem pré-selecionada nesta forma (CX-2); uma por forma',
    required: false,
  })
  isDefault?: boolean;
}

export class CreateBankAccountDto {
  @IsNotEmpty({ message: 'Dê um nome para a conta' })
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

  /* Caixa do dia (Fase 7.1, contrato seção 5): valores em centavos */

  @IsOptional()
  @IsEnum(BankAccountKind)
  @ApiProperty({
    enum: BankAccountKind,
    required: false,
    description: 'CASH, BANK ou CARD (CX-3)',
  })
  kind?: BankAccountKind;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    required: false,
    description: 'Contagem às cegas: só CASH com controle',
  })
  blindCount?: boolean;

  @IsOptional()
  @IsInt({ message: 'A tolerância é um valor em centavos' })
  @Min(0, { message: 'A tolerância não pode ser negativa' })
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Centavos; nula = sem tolerância',
  })
  shortageTolerance?: number | null;

  @IsOptional()
  @IsInt({ message: 'O saldo inicial é um valor em centavos' })
  @ApiProperty({ required: false, description: 'Centavos' })
  openingBalance?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data do saldo inicial inválida' })
  @ApiProperty({ required: false, example: '2026-09-07' })
  openingDate?: string;
}

import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class EditCashRegisterDto {
  cashRegisterId: string;

  @ApiProperty({ description: 'Valor a ser adicionado', example: 500 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Tipo da transação', enum: TransactionType })
  @IsNotEmpty()
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({
    description: 'Motivo da transação',
    example: 'Transferência bancária',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class TransferDto {
  @ApiProperty({
    description: 'ID da conta de origem',
    example: 'b305cdc3-3fef-4f49-95d8-0bc48b02c00c',
  })
  @IsNotEmpty()
  @IsUUID()
  sourceBankAccountId: string;

  @ApiProperty({
    description: 'ID da conta de destino',
    example: 'b305cdc3-3fef-4f49-95d8-0bc48b02c00c',
  })
  @IsNotEmpty()
  @IsUUID()
  targetBankAccountId: string;

  @ApiProperty({ description: 'Valor da transferência', example: 1000 })
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Forma de transferência',
    example: 'Transferência bancária',
  })
  @IsNotEmpty()
  @IsString()
  transferMethod: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReceiptPartDto } from '../../cash-control/dto/receipt-part.dto';

/** A frente de caixa (contrato, seção 5): valores em centavos. */
export class OpenCashSessionDto {
  @ApiPropertyOptional({ description: 'Sem ela, a primeira frente livre' })
  @IsOptional()
  @IsUUID()
  cashFrontId?: string;

  @ApiProperty({ description: 'O troco que já está na gaveta' })
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'O troco inicial não pode ser negativo' })
  openingBalance: number;
}

export class CashSessionMovementDto {
  @ApiProperty({ enum: ['WITHDRAWAL', 'SUPPLY'] })
  @IsIn(['WITHDRAWAL', 'SUPPLY'])
  kind: 'WITHDRAWAL' | 'SUPPLY';

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  amount: number;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    description: 'A conta de origem ou destino; sem ela, a conta da gaveta',
  })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class CloseCashSessionDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedCash: number;

  @ApiPropertyOptional({ description: 'O que fica na gaveta para amanhã' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  keep?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReceiveSaleDto {
  @ApiProperty({ type: [ReceiptPartDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptPartDto)
  parts: ReceiptPartDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deliver?: boolean;

  @ApiPropertyOptional({ description: 'Arredondamento no balcão (FC-18)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'Dispensar o sinal mínimo (FC-17)' })
  @IsOptional()
  @IsBoolean()
  waiveDownPayment?: boolean;
}

export class SaleReasonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason: string;
}

export class BillSaleDto {
  @ApiProperty()
  @IsString()
  clientId: string;

  @ApiProperty()
  @IsString()
  paymentConditionId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  installmentQty: number;

  @ApiProperty({ example: '2026-11-07' })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

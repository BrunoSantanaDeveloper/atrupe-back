import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CashRoundingType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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

  @ApiPropertyOptional({
    description: 'O troco dado, em centavos (fica no comprovante, FC-16)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  change?: number;

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

/** Rejeitar a venda na fila do caixa (FC-13.1): o motivo de rejeição do cadastro, quando o plano o tem. */
export class RejectSaleDto {
  @ApiPropertyOptional({ description: 'Motivo de rejeição (cadastro)' })
  @IsOptional()
  @IsUUID('4')
  reasonId?: string;
}

/** O cadastro da frente de caixa (FC-7, FC-15, FC-18): o que vier muda. */
export class CashFrontDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ description: 'Contagem às cegas no fechamento' })
  @IsOptional()
  @IsBoolean()
  blindCount?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Tolerância da quebra, em centavos; nula = sem tolerância',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  shortageTolerance?: number | null;

  @ApiPropertyOptional({ enum: CashRoundingType })
  @IsOptional()
  @IsEnum(CashRoundingType)
  roundingType?: CashRoundingType;

  @ApiPropertyOptional({
    description:
      'Em valor: centavos (até R$ 1.000,00); em percentual: centésimos de ponto (500 = 5%)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  roundingLimit?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A conta Caixa da gaveta',
  })
  @IsOptional()
  @IsUUID()
  drawerAccountId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A conta do PIX desta frente (vazio: a padrão da forma)',
  })
  @IsOptional()
  @IsUUID()
  pixAccountId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'A conta do cartão desta frente (vazio: a padrão da forma)',
  })
  @IsOptional()
  @IsUUID()
  cardAccountId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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

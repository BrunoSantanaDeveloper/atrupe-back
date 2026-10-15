import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { CashRegisterStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** O caixa do dia (contrato, seção 5): valores em centavos. */
export class CashDayFilterDto {
  @ApiPropertyOptional({ enum: CashRegisterStatus })
  @IsOptional()
  @IsEnum(CashRegisterStatus)
  status?: CashRegisterStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // Os filtros da tela antiga continuam valendo
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  bankName?: string;
}

export class CashDayOpenDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Conta não encontrada' })
  bankAccountId: string;

  @ApiPropertyOptional({ example: '2026-10-07', description: 'Sem ela, hoje' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  date?: string;
}

export class CashAdjustmentDto {
  @ApiProperty({ example: -1500, description: 'Centavos, com sinal' })
  @IsInt({ message: 'Informe o valor do ajuste' })
  amount: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty()
  @IsOptional()
  @IsUUID()
  natureId?: string;

  @ApiProperty()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class CashDayCloseDto {
  @ApiProperty({ example: 149400, description: 'Centavos' })
  @IsInt({ message: 'Informe o valor contado' })
  informed: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CashDayReopenDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * A transferência: o corpo novo (fromId, toId, method, amount em centavos,
 * date) ou o da tela antiga (sourceBankAccountId…, em reais), que convive
 * até ela sair.
 */
export class CashTransferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  fromId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  toId?: string;

  @ApiPropertyOptional({ example: 'PIX' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: string;

  @ApiPropertyOptional({ description: 'Centavos (corpo novo); reais (antigo)' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-10-07' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  date?: string;

  @ApiPropertyOptional({
    description:
      'Liquidação da operadora de cartão (FC-10): a taxa, em centavos. O destino recebe o valor menos a taxa',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsUUID()
  sourceBankAccountId?: string;

  @IsOptional()
  @IsUUID()
  targetBankAccountId?: string;

  @IsOptional()
  @IsString()
  transferMethod?: string;

  @IsOptional()
  @IsDateString()
  transferDate?: Date;
}

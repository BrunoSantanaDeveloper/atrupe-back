import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A conciliação com o extrato (CX-6): valores em centavos. */
export class ConciliationFilterDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  to?: string;
}

export class ConciliationImportDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId: string;
}

export class ConciliationMatchDto {
  @ApiProperty({
    description: 'O lançamento, ou a parcela prevista, que a linha casa',
  })
  @IsUUID()
  targetId: string;
}

export class ConciliationCreateDto {
  @ApiProperty()
  @IsUUID()
  natureId: string;

  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class ConciliationLiquidateDto {
  @ApiProperty({ description: 'A conta da operadora de cartão' })
  @IsUUID()
  cardAccountId: string;

  @ApiProperty({
    description: 'O valor cheio das vendas liquidadas, em centavos',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  gross: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InboundInvoiceStatus, StockMovementKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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

class PageDto {
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
}

export class StockFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: ['todos', 'abaixo-do-minimo', 'zerados'] })
  @IsOptional()
  @IsIn(['todos', 'abaixo-do-minimo', 'zerados'])
  status?: 'todos' | 'abaixo-do-minimo' | 'zerados';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class StockMovementFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: StockMovementKind })
  @IsOptional()
  @IsEnum(StockMovementKind)
  kind?: StockMovementKind;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  materialId?: string;
}

export class InvoiceEntryFilterDto extends PageDto {
  @ApiPropertyOptional({
    enum: [...Object.values(InboundInvoiceStatus), 'ALL'],
    description: 'Sem ele, as que aguardam entrada',
  })
  @IsOptional()
  @IsIn([...Object.values(InboundInvoiceStatus), 'ALL'])
  status?: InboundInvoiceStatus | 'ALL';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class MatchInvoiceItemDto {
  @ApiProperty()
  @IsUUID()
  materialId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  variationId?: string | null;

  @ApiProperty({ description: '1 unidade do fornecedor = N do material' })
  @Type(() => Number)
  @IsNumber()
  conversionFactor: number;
}

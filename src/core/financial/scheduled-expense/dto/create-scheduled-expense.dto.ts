import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RecurringType } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class CreateScheduledExpenseDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Valor da despesa agendada',
    example: 50000,
  })
  amount: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Descrição da despesa agendada',
    example: 'desc',
    required: false,
  })
  description?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(31)
  @ApiProperty({
    description: 'Dia do vencimento da despesa agendada',
    example: 15,
  })
  dueDay: number;

  @IsNotEmpty()
  @IsEnum(RecurringType)
  @ApiProperty({
    description: 'Tipo de recorrência da despesa',
    enum: RecurringType,
    example: 'MONTHLY',
  })
  recurringType: RecurringType;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do fornecedor associado à despesa',
    example: '0e3b706d-b81a-481a-808f-2a1d0f19ea5b',
    required: false,
  })
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da natureza/categoria da despesa',
    example: '461c3a53-b469-4591-8f10-e2cd10dda73f',
    required: false,
  })
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da subcategoria da despesa',
    example: 'b28516b5-022e-4aa7-b188-047c7fdb0578',
    required: false,
  })
  subCategoryId?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Status da despesa (ativa ou inativa)',
    example: true,
    required: false,
    default: true,
  })
  isActive?: boolean;
}

export class UpdateScheduledExpenseDto extends CreateScheduledExpenseDto {}

export class ScheduledExpenseFilterDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Busca por descrição da despesa',
    example: 'aluguel',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do fornecedor para filtrar',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria para filtrar',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  categoryId?: string;

  @IsOptional()
  @IsEnum(RecurringType)
  @ApiProperty({
    description: 'Tipo de recorrência para filtrar',
    enum: RecurringType,
    example: RecurringType.MONTHLY,
    required: false,
  })
  recurringType?: RecurringType;
}

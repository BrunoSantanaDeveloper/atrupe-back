import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  Min,
  Max,
  IsDateString,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RecurringType } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { Transform } from 'class-transformer';

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

export class LaunchScheduledExpenseDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ApiProperty({
    description: 'Lista de IDs das despesas programadas a serem lançadas',
    example: ['uuid-1', 'uuid-2'],
    type: [String],
  })
  scheduledExpenseIds: string[];

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description:
      'Data de competência (se informada, sobrescreve o valor padrão da despesa)',
    example: '2025-02-02',
    required: false,
  })
  competenceDate?: string;

  @IsOptional()
  @IsDateString()
  @ApiProperty({
    description:
      'Data de vencimento (se informada, sobrescreve o valor padrão da despesa)',
    example: '2025-02-02',
    required: false,
  })
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description:
      'Valor da movimentação (se informado, sobrescreve o valor padrão da despesa)',
    example: 40000,
    required: false,
  })
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(11)
  @ApiProperty({
    description:
      'Mês de referência para lançamento automático (0-11, onde 0=Janeiro, 11=Dezembro). Se não informado, usa o mês atual.',
    example: 8,
    required: false,
  })
  month?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description:
      'Ano de referência para lançamento automático. Se não informado, usa o ano atual.',
    example: 2025,
    required: false,
  })
  year?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Observação da movimentação',
    example: 'Lançamento manual das despesas programadas',
    required: false,
  })
  notes?: string;
}

export class ScheduledExpenseFilterDto extends BaseFilterDTO {
  @ApiProperty({
    description: 'Mês de referência (1-12)',
    required: false,
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  @Transform(({ value }) => {
    if (!value) {
      return new Date().getMonth() + 1;
    }
    return parseInt(value);
  })
  month: number;

  @ApiProperty({
    description: 'Ano de referência',
    required: false,
    example: 2024,
  })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => {
    if (!value) {
      return new Date().getFullYear();
    }
    return parseInt(value);
  })
  year: number;

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

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Status para filtrar (ACTIVE ou INACTIVE)',
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE'],
    required: false,
  })
  status?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Level1 da natureza (01=Receitas, 02=Despesas)',
    example: '02',
    required: false,
  })
  level1?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description:
      'Level2 da natureza (01=Administrativo, 02=Operacional, 03=Não operacional)',
    example: '01',
    required: false,
  })
  level2?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Código da natureza para filtrar',
    example: '02',
    required: false,
  })
  natureCode?: string;
}

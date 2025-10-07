import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  IsOptional,
} from 'class-validator';
import { ItemType, SheetStatus } from '@prisma/client';

export class UpdateSalaryItemDto {
  @ApiProperty({
    description: 'Tipo do item (Acréscimo, Desconto ou Adiantamento)',
    enum: ItemType,
    example: ItemType.INCREASE,
    required: false,
  })
  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @ApiProperty({
    description: 'Descrição do item (ex: Salário Base, Bonus, etc.)',
    example: 'Bonus de Férias',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Valor do item',
    example: 500.0,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class ToggleSalarySheetStatusDto {
  @ApiProperty({
    description: 'ID da folha de pagamento',
    example: 'uuid-da-folha',
  })
  @IsUUID()
  payrollId: string;

  @ApiProperty({
    description: 'Novo status da folha (OPEN ou CLOSED)',
    enum: SheetStatus,
    example: SheetStatus.OPEN,
  })
  @IsEnum(SheetStatus)
  status: SheetStatus;
}

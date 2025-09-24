import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  IsOptional,
} from 'class-validator';
import { ItemType, SheetStatus } from '@prisma/client';

export class UpdateSalaryItemDto {
  @ApiProperty({
    description: 'ID do item que será atualizado',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  @IsNotEmpty()
  id: string;

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

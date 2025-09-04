import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
} from 'class-validator';
import { ItemType } from '@prisma/client';

export class AddSalaryItemDto {
  @ApiProperty({
    description: 'Tipo do item (Acréscimo, Desconto ou Adiantamento)',
    enum: ItemType,
    example: ItemType.INCREASE,
  })
  @IsEnum(ItemType)
  type: ItemType;

  @ApiProperty({
    description: 'Descrição do item (ex: Salário Base, Bonus, etc.)',
    example: 'Bonus de Férias',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Valor do item',
    example: 500.0,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'ID da folha de pagamento à qual o item será adicionado',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  salarySheetId: string;
}

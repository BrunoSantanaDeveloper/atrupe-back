import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
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
}

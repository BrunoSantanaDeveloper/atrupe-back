import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsInt, Max } from 'class-validator';
import { ItemType, PayrollBehavior } from '@prisma/client';

export class UpdatePayrollTemplateDto {
  @ApiPropertyOptional({
    description: 'New reference (name) of the cost item',
    example: 'Vale transporte',
  })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Payroll operation of the cost item',
    enum: ItemType,
    example: ItemType.DISCOUNT,
  })
  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @ApiPropertyOptional({
    description:
      'Default amount applied when the item is added to a new employee',
    example: 200,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  defaultAmount?: number;

  // A folha com comportamento (ALT-18)
  @IsOptional()
  @IsEnum(PayrollBehavior, { message: 'Comportamento inválido' })
  behavior?: PayrollBehavior;

  @IsOptional()
  @IsInt({ message: 'O acréscimo vai em centavos' })
  @Min(0, { message: 'O valor não pode ser negativo' })
  defaultIncrease?: number;

  @IsOptional()
  @IsInt({ message: 'O desconto vai em centavos' })
  @Min(0, { message: 'O valor não pode ser negativo' })
  defaultDiscount?: number;

  // A alíquota dos encargos editáveis (INSS e FGTS)
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'A alíquota é um percentual com até duas casas' },
  )
  @Min(0, { message: 'A alíquota precisa ficar entre 0 e 100%' })
  @Max(100, { message: 'A alíquota precisa ficar entre 0 e 100%' })
  rate?: number;
}

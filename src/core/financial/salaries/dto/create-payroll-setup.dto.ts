import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { ItemType, PayrollBehavior } from '@prisma/client';

export class CreatePayrollSetupDto {
  @ApiPropertyOptional({
    description: 'Name identifier for the payroll setup',
    example: 'Base Salary',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Base salary amount',
    example: 5000.0,
    minimum: 0,
  })
  // Com o comportamento, o valor vem de defaultIncrease/defaultDiscount
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({
    description: 'Type of the payroll setup',
    example: 'INCREASE',
  })
  @IsOptional()
  @IsEnum(ItemType)
  type?: ItemType;

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

  @ApiPropertyOptional({
    description:
      'Whether this payroll setup is active/enabled for the employee',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isSet?: boolean;

  companyId?: string;
}

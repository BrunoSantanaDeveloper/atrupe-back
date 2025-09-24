import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '@prisma/client';

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
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Type of the payroll setup',
    example: 'INCREASE',
  })
  @IsEnum(ItemType)
  type: ItemType;

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

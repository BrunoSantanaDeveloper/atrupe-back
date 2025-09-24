import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ItemType } from '@prisma/client';

export class UpdatePayrollSetupDto {
  @ApiProperty({
    description: 'The name for the payroll setup',
    example: 'Base Salary',
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'The amount for the payroll setup',
    example: 5000.0,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({
    description: 'The type of payroll setup',
    enum: ItemType,
    example: ItemType.INCREASE,
    required: false,
  })
  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @ApiProperty({
    description:
      'Whether this payroll setup is active/enabled for the employee',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isSet?: boolean;

  @ApiProperty({
    description: 'The employee ID associated with this payroll setup',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeId?: string;
}

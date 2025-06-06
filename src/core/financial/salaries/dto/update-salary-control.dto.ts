import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ItemType } from '@prisma/client';

export class UpdateSalaryControlDto {
  @ApiProperty({
    description: 'The reference for the salary control',
    example: 'SAL-2024-01',
    required: false,
  })
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiProperty({
    description: 'The amount for the salary control',
    example: 5000.0,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({
    description: 'The date of the salary control',
    example: '2024-01-01',
    required: false,
  })
  @IsString()
  @IsOptional()
  date?: string;

  @ApiProperty({
    description: 'The type of salary control',
    enum: ItemType,
    example: ItemType.INCREASE,
    required: false,
  })
  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @ApiProperty({
    description:
      'Whether this salary control is active/enabled for the employee',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isSet?: boolean;

  @ApiProperty({
    description: 'The employee ID associated with this salary control',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeId?: string;
}

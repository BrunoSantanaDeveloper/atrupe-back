import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '@prisma/client';

export class CreateSalaryControlDto {
  @ApiPropertyOptional({
    description: 'Reference identifier for the salary control',
    example: 'SAL-2024-01',
  })
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiProperty({
    description: 'Base salary amount',
    example: 5000.0,
    minimum: 0,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Type of the salary control',
    example: 'INCREASE',
  })
  @IsEnum(ItemType)
  type: ItemType;

  @ApiPropertyOptional({
    description:
      'Whether this salary control is active/enabled for the employee',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isSet?: boolean;

  companyId?: string;
}

import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsEnum,
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
    description: 'UUID of the employee',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  employeeId: string;

  @ApiProperty({
    description: 'Type of the salary control',
    example: 'INCREASE',
  })
  @IsEnum(ItemType)
  type: ItemType;

  companyId: string;
}

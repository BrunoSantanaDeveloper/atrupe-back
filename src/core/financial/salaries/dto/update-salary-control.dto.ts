import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsOptional, IsEnum } from 'class-validator';
import { CostItemType } from './create-cost-item.dto';

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
    description: 'The type of cost item',
    enum: CostItemType,
    example: CostItemType.INCREASE,
    required: false,
  })
  @IsEnum(CostItemType)
  @IsOptional()
  type?: CostItemType;

  @ApiProperty({
    description: 'The employee ID associated with this salary control',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeId?: string;
}

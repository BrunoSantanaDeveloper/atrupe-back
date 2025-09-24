import { IsString, IsNumber, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum CostItemType {
  INCREASE = 'INCREASE',
  DISCOUNT = 'DISCOUNT',
}

export class CreateCostItemDto {
  @ApiProperty({
    description: 'Description of the cost item',
    example: 'Transportation allowance',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Value of the cost item',
    example: 500.0,
    minimum: 0,
  })
  @IsNumber()
  value: number;

  @ApiProperty({
    description: 'Type of the cost item (INCREASE or DISCOUNT)',
    enum: CostItemType,
    example: CostItemType.INCREASE,
  })
  @IsEnum(CostItemType)
  type: CostItemType;

  @ApiProperty({
    description: 'UUID of the associated payroll setup',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  salaryControlId: string;
}

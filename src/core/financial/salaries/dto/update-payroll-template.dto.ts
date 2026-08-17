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
import { ItemType } from '@prisma/client';

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
}

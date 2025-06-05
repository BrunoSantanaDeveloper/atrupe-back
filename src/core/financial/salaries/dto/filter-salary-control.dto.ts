import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ItemType } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterSalaryControlDto extends BaseFilterDTO {
  @ApiPropertyOptional({
    description: 'Search term to filter by employee name or reference',
    example: 'John',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'UUID of the sector/department to filter by',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  sectorId?: string;

  @ApiPropertyOptional({
    description: 'Employee name to filter by',
    example: 'John Doe',
  })
  @IsString()
  @IsOptional()
  employeeName?: string;

  @ApiPropertyOptional({
    description: 'Type of salary control to filter by',
    enum: ItemType,
    example: ItemType.INCREASE,
  })
  @IsEnum(ItemType)
  @IsOptional()
  costType?: ItemType;
}

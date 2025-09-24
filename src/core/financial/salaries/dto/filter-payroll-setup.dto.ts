import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ItemType } from '@prisma/client';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterPayrollSetupDto extends BaseFilterDTO {
  @ApiPropertyOptional({
    description: 'Search term to filter by employee name',
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
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Type of payroll setup to filter by',
    enum: ItemType,
    example: ItemType.INCREASE,
  })
  @IsEnum(ItemType)
  @IsOptional()
  costType?: ItemType;
}

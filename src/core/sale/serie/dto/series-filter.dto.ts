import { ApiProperty } from '@nestjsx/crud/lib/crud';
import { Transform } from 'class-transformer';
import { IsOptional, IsBoolean } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class SeriesFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @ApiProperty({
    description: 'Filter by active series',
    example: 'true',
  })
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean;

  // Set by controller from req.user — not from query params
  employeeId?: string;
  isAdmin?: boolean;
}

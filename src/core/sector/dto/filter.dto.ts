import { SectorKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class SectorFilterDto extends BaseFilterDTO {
  @IsOptional()
  @IsBoolean()
  toService: boolean;

  @IsOptional()
  @IsEnum(SectorKind)
  kind: SectorKind;
}

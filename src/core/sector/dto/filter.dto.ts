import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class SectorFilterDto extends BaseFilterDTO {
  // @IsOptional()
  // @IsBoolean()
  // toService: boolean;

  // @IsOptional()
  // @IsEnum(SectorKind)
  // kind: SectorKind;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  @ApiProperty({
    description: 'Filtrar se é etapa de produção',
    example: true,
    required: false,
  })
  isProductionStage?: boolean;
}

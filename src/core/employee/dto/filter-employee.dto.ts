import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class FilterEmployeeDto extends BaseFilterDTO {
  @ApiPropertyOptional({
    description: 'Status do funcionário (ativo/inativo)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Busca por nome do funcionário',
    example: 'João Silva',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Busca por ID do setor',
    example: 'uuid',
  })
  @IsOptional()
  @IsString()
  sectorId?: string;
}

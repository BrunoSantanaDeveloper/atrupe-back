import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsIn } from 'class-validator';
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
    description: 'Status do funcionário',
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

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

  @ApiPropertyOptional({
    description: 'Campo para ordenação',
    example: 'name',
  })
  @IsOptional()
  @IsString()
  orderBy?: string;

  @ApiPropertyOptional({
    description: 'Direção da ordenação',
    example: 'asc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderDirection?: 'asc' | 'desc';
}

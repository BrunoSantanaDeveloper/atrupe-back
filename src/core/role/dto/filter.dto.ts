import { IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class RoleFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa para filtrar os cargos',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  sectorId?: string;
}

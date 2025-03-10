import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class NatureFilterDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Filtro por nível 1',
    example: 'level1_value',
    required: false,
  })
  level1?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Filtro por nível 2',
    example: 'level2_value',
    required: false,
  })
  level2?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Busca por descrição ou código',
    example: 'search_term',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Status da natureza',
    example: 'ACTIVE',
    required: false,
  })
  status?: string;
}

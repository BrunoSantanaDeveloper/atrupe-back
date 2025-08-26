import {
  IsNumberString,
  IsOptional,
  IsUUID,
  IsString,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BaseFilterDTO {
  @IsOptional()
  @IsNumberString()
  @ApiProperty({
    description: 'Número da página para paginação',
    example: '1',
    required: false,
    default: '1',
  })
  page: string = '1';

  @IsOptional()
  @IsNumberString()
  @ApiProperty({
    description: 'Número de itens por página para paginação',
    example: '10',
    required: false,
    default: '10',
  })
  limit: string = '10';

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa para filtrar os resultados',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  companyId: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Campo para ordenação',
    example: 'updatedAt',
    required: false,
  })
  orderBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  @ApiProperty({
    description: 'Direção da ordenação',
    example: 'desc',
    required: false,
    enum: ['asc', 'desc'],
  })
  orderDirection?: 'asc' | 'desc';
}

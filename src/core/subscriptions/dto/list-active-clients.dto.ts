import { IsOptional, IsNumber, Min, IsIn, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListActiveClientsDto {
  @ApiPropertyOptional({ description: 'Página atual', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Número de itens por página',
    default: 10,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Filtrar por status',
    enum: ['ativas', 'bloqueadas', 'inativas', 'canceladas'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['ativas', 'bloqueadas', 'inativas', 'canceladas'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Busca por nome da empresa, email ou telefone',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

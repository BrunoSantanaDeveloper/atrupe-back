import { ClientStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, IsIn } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class SupplierFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description:
      'Texto de busca para filtrar fornecedores por nome ou outros campos',
    example: 'Supplier Name',
    required: false,
  })
  search: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria para filtrar os fornecedores',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  categoryId: string;

  @IsOptional()
  @IsEnum(ClientStatus)
  @ApiProperty({
    description: 'Status do fornecedor para filtrar os resultados',
    example: ClientStatus.ACTIVE,
    required: false,
    enum: ClientStatus,
  })
  status: ClientStatus;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Campo para ordenação',
    example: 'name',
    required: false,
  })
  orderBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  @ApiProperty({
    description: 'Direção da ordenação',
    example: 'asc',
    required: false,
    enum: ['asc', 'desc'],
  })
  orderDirection?: 'asc' | 'desc';
}

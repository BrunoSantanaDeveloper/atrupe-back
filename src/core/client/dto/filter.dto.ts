import { ClientStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, IsIn } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class ClientFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Texto de busca para filtrar clientes por nome ou email',
    example: 'John Doe',
    required: false,
  })
  search: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da categoria do cliente para filtrar os clientes',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  categoryId: string;

  @IsOptional()
  @IsEnum(ClientStatus)
  @ApiProperty({
    description: 'Status do cliente para filtrar os clientes',
    example: ClientStatus.ACTIVE,
    required: false,
    enum: ClientStatus,
  })
  status: ClientStatus;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do colaborador responsável para filtrar a carteira',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  responsibleId?: string;

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

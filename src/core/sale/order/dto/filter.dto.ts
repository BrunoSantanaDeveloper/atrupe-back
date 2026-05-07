import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { BaseFilterDTO } from '../../../../shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class FilterOrderDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Texto de busca para filtrar os orçamentos',
    example: 'Produto exemplo',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  @ApiProperty({
    description: 'Status do orçamento para filtrar os resultados',
    example: OrderStatus.IN_PRODUCTION,
    enum: OrderStatus,
    required: false,
  })
  status?: OrderStatus;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do vendedor para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da série para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  serieId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do cliente para filtrar os orçamentos',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Filtro por fase fiscal: NAO_EMITIDA | EM_DIGITACAO | EMITIDA | TODAS',
    example: 'NAO_EMITIDA',
    required: false,
  })
  nfeStatus?: string;
}

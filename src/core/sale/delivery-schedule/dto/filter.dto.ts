import { ApiProperty } from '@nestjs/swagger';
import { DeliveryScheduleStatus } from '@prisma/client';
import { IsOptional, IsString, IsEnum, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class DeliveryScheduleFitlerDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Texto de busca para filtrar os orçamentos',
    example: 'Produto exemplo',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsEnum(DeliveryScheduleStatus)
  @ApiProperty({
    description: 'Status do orçamento para filtrar os resultados',
    example: DeliveryScheduleStatus.IN_PRODUCTION,
    enum: DeliveryScheduleStatus,
    required: false,
  })
  status?: DeliveryScheduleStatus;

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
}

import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { BaseFilterDTO } from '../../../../shared/dto/filter.dto';

export class FilterOrderDto extends BaseFilterDTO {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  serieId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;
}

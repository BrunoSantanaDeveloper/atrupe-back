import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CommissionReportFilterDto {
  @IsOptional()
  @IsEnum(['sold_value', 'received_value'])
  commissionType?: 'sold_value' | 'received_value';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['vendedor', 'cliente', 'none'])
  groupBy?: 'vendedor' | 'cliente' | 'none';

  @IsOptional()
  @IsEnum(['receivedDate', 'saleDate', 'valueDesc', 'valueAsc'])
  orderBy?: 'receivedDate' | 'saleDate' | 'valueDesc' | 'valueAsc';

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;
}

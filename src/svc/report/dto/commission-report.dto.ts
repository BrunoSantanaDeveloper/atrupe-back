import { IsOptional, IsEnum, IsDateString, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CommissionReportFilterDto {
  @IsOptional()
  @IsEnum(['all', 'sold_value', 'received_value'])
  commissionType?: 'all' | 'sold_value' | 'received_value';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  receivedStartDate?: string;

  @IsOptional()
  @IsDateString()
  receivedEndDate?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsEnum(['vendedor', 'saleDate', 'receivedDate', 'none'])
  groupBy?: 'vendedor' | 'saleDate' | 'receivedDate' | 'none';

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

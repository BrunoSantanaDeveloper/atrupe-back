import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class FinancialReportFilterDto {
  @IsOptional()
  @IsEnum(['receitas', 'despesas'])
  tab?: 'receitas' | 'despesas';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['all', 'received', 'confirmed', 'to_receive', 'overdue'])
  status?: 'all' | 'received' | 'confirmed' | 'to_receive' | 'overdue';

  @IsOptional()
  @IsEnum(['none', 'client', 'date'])
  groupBy?: 'none' | 'client' | 'date';

  @IsOptional()
  @IsEnum(['receivedDate', 'valueDesc', 'valueAsc', 'clientName'])
  orderBy?: 'receivedDate' | 'valueDesc' | 'valueAsc' | 'clientName';

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;
}

// Response DTOs
export interface FinancialSummaryResponse {
  received: number;
  confirmed: number;
  toReceive: number;
  overdue: number;
  receivedCount: number;
  confirmedCount: number;
  toReceiveCount: number;
  overdueCount: number;
}

export interface FinancialChartDataPoint {
  date: string;
  label: string;
  received: number;
  confirmed: number;
  toReceive: number;
  overdue: number;
}

export interface FinancialRecord {
  id: string;
  clientId: string;
  clientName: string;
  description: string;
  receivedDate: string | null;
  value: number;
  percentage: number;
  status: 'received' | 'confirmed' | 'to_receive' | 'overdue';
}

export interface FinancialGroup {
  clientId: string;
  clientName: string;
  count: number;
  total: number;
  records: FinancialRecord[];
}

export interface FinancialTableResponse {
  grouped: boolean;
  records: FinancialRecord[];
  groups?: FinancialGroup[];
  totalCount: number;
  pagination: {
    page: number;
    totalPages: number;
    totalRecords: number;
  };
}

import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class CashFlowReportFilterDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['all', 'revenue', 'expense'])
  movement?: 'all' | 'revenue' | 'expense';

  @IsOptional()
  @IsEnum(['none', 'date', 'client'])
  groupBy?: 'none' | 'date' | 'client';

  @IsOptional()
  @IsEnum(['dueDate', 'valueDesc', 'valueAsc', 'clientName'])
  orderBy?: 'dueDate' | 'valueDesc' | 'valueAsc' | 'clientName';

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;
}

// Response DTOs
export interface CashFlowSummaryResponse {
  expectedRevenue: number;
  expectedExpenses: number;
  expectedBalance: number;
}

export interface CashFlowChartDataPoint {
  date: string;
  label: string;
  revenue: number;
  expenses: number;
  balance: number;
}

export interface CashFlowRecord {
  id: string;
  clientId: string;
  clientName: string;
  description: string;
  dueDate: string;
  value: number;
  percentage: number;
  type: 'revenue' | 'expense';
}

export interface CashFlowGroup {
  date: string;
  clientId?: string;
  clientName?: string;
  count: number;
  total: number;
  records: CashFlowRecord[];
}

export interface CashFlowTableResponse {
  grouped: boolean;
  records: CashFlowRecord[];
  groups?: CashFlowGroup[];
  totalCount: number;
  pagination: {
    page: number;
    totalPages: number;
    totalRecords: number;
  };
}

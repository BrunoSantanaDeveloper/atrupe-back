import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SalesReportFilterDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  originId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['none', 'client', 'seller'])
  groupBy?: 'none' | 'client' | 'seller';

  @IsOptional()
  @IsEnum(['approvedDate', 'valueDesc', 'valueAsc'])
  orderBy?: 'approvedDate' | 'valueDesc' | 'valueAsc';

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;
}

// Response DTOs
export interface SalesReportSummaryResponse {
  approvedTotal: number;
  approvedCount: number;
  rejectedTotal: number;
  rejectedCount: number;
  noResponseTotal: number;
  averageTicket: number;
  commission: number;
  approvalTime: string;
}

export interface SalesEvolutionDataPoint {
  day: string;
  approved: number;
}

export interface ApprovedRejectedDataPoint {
  label: string;
  approved: number;
  expired: number;
  rejected: number;
}

export interface OriginChartDataPoint {
  name: string;
  value: number;
  color: string;
}

export interface TopProductItem {
  name: string;
  type: string;
  value: number;
}

export interface TopClientItem {
  name: string;
  value: number;
}

export type SalePhase = 'em-producao' | 'entregue' | 'aguardando';

export interface SaleRecordItem {
  id: string;
  clientName: string;
  serviceDescription: string;
  approvedDate: string | null;
  dueDate: string;
  value: number;
  phase: SalePhase;
  phasePercentage: number;
}

export interface SalesClientGroup {
  clientId: string;
  clientName: string;
  count: number;
  total: number;
  records: SaleRecordItem[];
}

export interface SalesSellerGroup {
  sellerId: string;
  sellerName: string;
  count: number;
  total: number;
  records: SaleRecordItem[];
}

export type SalesTableDataResponse =
  | { grouped: false; records: SaleRecordItem[]; totalCount: number }
  | { grouped: true; groups: SalesClientGroup[]; totalCount: number }
  | { grouped: true; groups: SalesSellerGroup[]; totalCount: number };

export interface SalesReportFullResponse {
  summary: SalesReportSummaryResponse;
  evolution: SalesEvolutionDataPoint[];
  approvedRejected: ApprovedRejectedDataPoint[];
  quotationsOrigin: OriginChartDataPoint[];
  ordersOrigin: OriginChartDataPoint[];
  topProducts: TopProductItem[];
  topClients: TopClientItem[];
  tableData: SalesTableDataResponse;
  pagination: {
    page: number;
    totalPages: number;
    totalRecords: number;
  };
}

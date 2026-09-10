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
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  serieId?: string;

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
  @IsEnum(['approvedDate', 'deliveryDate', 'valueDesc', 'valueAsc'])
  orderBy?: 'approvedDate' | 'deliveryDate' | 'valueDesc' | 'valueAsc';

  // Qual data o período filtra na tabela/PDF/Excel de vendas. Os cards e
  // gráficos continuam sempre pela aprovação.
  @IsOptional()
  @IsEnum(['approvedAt', 'deliveryDate'])
  periodBy?: 'approvedAt' | 'deliveryDate';

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
  noResponseCount: number;
  expiredTotal: number;
  expiredCount: number;
  canceledTotal: number;
  canceledCount: number;
  averageTicket: number;
  commission: number;
  approvalTime: string;
}

export interface SalesEvolutionDataPoint {
  day: string;
  approved: number;
  count: number;
}

export interface SalesEvolutionYearSeries {
  year: number;
  data: { month: string; approved: number; count: number }[];
}

export interface SalesEvolutionResponse {
  mode: 'daily' | 'monthly' | 'yearly';
  data: SalesEvolutionDataPoint[];
  yearlyData: SalesEvolutionYearSeries[];
}

export interface ApprovedRejectedDataPoint {
  label: string;
  approved: number;
  canceled: number;
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

export type SalePhase = 'em-producao' | 'entregue' | 'aguardando' | 'cancelada';

export interface SaleRecordItem {
  id: string;
  osNumber: string;
  clientName: string;
  clientCity: string | null;
  serviceDescription: string;
  approvedDate: string | null;
  deliveryDate: string | null;
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

// `totalValue` é o total do período inteiro (todas as páginas), base da
// porcentagem exibida na tabela.
export type SalesTableDataResponse =
  | {
      grouped: false;
      records: SaleRecordItem[];
      totalCount: number;
      totalValue: number;
    }
  | {
      grouped: true;
      groups: SalesClientGroup[];
      totalCount: number;
      totalValue: number;
    }
  | {
      grouped: true;
      groups: SalesSellerGroup[];
      totalCount: number;
      totalValue: number;
    };

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

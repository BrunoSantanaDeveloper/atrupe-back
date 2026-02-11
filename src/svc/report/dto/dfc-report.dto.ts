import { IsOptional, IsEnum, IsDateString } from 'class-validator';

export class DfcReportFilterDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['competencia', 'realizado'])
  regime?: 'competencia' | 'realizado';
}

import { CostCriterion, SectorAllocationCriterion } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PERCENT = 'O percentual precisa ficar entre 0 e 100%';
const TWO_PLACES = 'Percentual com até duas casas';

const toInt = ({ value }) =>
  value === undefined || value === '' ? undefined : Number(value);

class PageDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'No máximo 100 por página' })
  limit?: number;
}

export class AdminExpenseFilterDto extends PageDto {
  @IsOptional()
  @IsEnum(CostCriterion, { message: 'Critério inválido' })
  criterion?: CostCriterion;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class UpdateAdminExpenseDto {
  @IsEnum(CostCriterion, { message: 'Critério inválido' })
  criterion: CostCriterion;

  // Centavos; só no manual
  @IsOptional()
  @IsInt({ message: 'O valor vai em centavos' })
  manualValue?: number | null;
}

class SectorShareDto {
  @IsUUID('all', { message: 'Setor inválido' })
  sectorId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: TWO_PLACES })
  @Min(0, { message: PERCENT })
  @Max(100, { message: PERCENT })
  percentage: number;
}

export class ExpenseAllocationDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SectorShareDto)
  allocations: SectorShareDto[];
}

class DistributionShareDto {
  @IsUUID('all', { message: 'Só setor produtivo recebe distribuição' })
  id: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: TWO_PLACES })
  @Min(0, { message: PERCENT })
  @Max(100, { message: PERCENT })
  percentage: number;
}

export class DistributionDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DistributionShareDto)
  percentages: DistributionShareDto[];
}

class EquipmentShareDto {
  @IsUUID('all', { message: 'Equipamento inválido' })
  assetId: string;

  // O rateio manual aceita mais de duas casas (BC-9); a faixa é conferida
  // no serviço, com o nome do bem na mensagem
  @IsNumber({}, { message: 'Percentual inválido' })
  percentage: number;
}

export class SectorAllocationDto {
  @IsEnum(SectorAllocationCriterion, { message: 'Critério inválido' })
  criterion: SectorAllocationCriterion;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EquipmentShareDto)
  percentages?: EquipmentShareDto[];
}

class CollaboratorHoursDto {
  @IsUUID('all', { message: 'Colaborador inválido' })
  id: string;

  @IsNumber({}, { message: 'Horas inválidas' })
  @Min(0, { message: 'As horas não podem ser negativas' })
  @Max(744, { message: 'O mês não tem tantas horas' })
  hours: number;
}

export class LaborHoursDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CollaboratorHoursDto)
  hours: CollaboratorHoursDto[];
}

export const COMPARISON_STATUS = ['todas', 'com-previsao', 'sem-previsao'];

export class ComparisonFilterDto extends PageDto {
  @IsOptional()
  @IsIn(['1', '3', '6', '12'], { message: 'Período inválido' })
  period?: string;

  @IsOptional()
  @IsIn(COMPARISON_STATUS, { message: 'Situação inválida' })
  status?: string;
}

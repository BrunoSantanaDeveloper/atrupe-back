import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  AssetCostNature,
  AssetKind,
  AssetUnit,
  AssetYieldUnit,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ASSET_STATUS_FILTERS = [
  'ativos',
  'em-depreciacao',
  'em-revisao',
  'inconsistencias',
  'inativos',
] as const;
export type AssetStatusFilter = (typeof ASSET_STATUS_FILTERS)[number];

export class AssetFilterDto {
  @IsOptional()
  @IsIn(ASSET_STATUS_FILTERS, { message: 'Situação inválida' })
  @ApiProperty({ required: false, enum: ASSET_STATUS_FILTERS })
  status?: AssetStatusFilter;

  @IsOptional()
  @IsUUID('all', { message: 'Setor não encontrado' })
  @ApiProperty({ required: false })
  sectorId?: string;

  @IsOptional()
  @IsEnum(AssetKind, { message: 'Tipo inválido' })
  @ApiProperty({ required: false, enum: AssetKind })
  kind?: AssetKind;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiProperty({ required: false })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false })
  limit?: number;
}

export class CreateAssetDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do bem' })
  @MaxLength(120)
  @ApiProperty()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ApiProperty({ required: false })
  imageUrl?: string | null;

  @IsEnum(AssetKind, { message: 'Escolha o tipo do bem' })
  @ApiProperty({ enum: AssetKind })
  kind: AssetKind;

  @IsUUID('all', { message: 'Setor não encontrado' })
  @ApiProperty()
  sectorId: string;

  @IsBoolean()
  @ApiProperty()
  detailed: boolean;

  @IsOptional()
  @IsEnum(AssetUnit, { message: 'Unidade inválida' })
  @ApiProperty({ required: false, enum: AssetUnit })
  unit?: AssetUnit | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({ required: false })
  monthlyProductivity?: number | null;

  @IsOptional()
  @IsDateString({}, { message: 'Data de aquisição inválida' })
  @ApiProperty({ required: false, example: '2026-09-10' })
  acquisitionDate?: string | null;

  @IsInt({ message: 'O valor de aquisição vai em centavos' })
  @Min(0, { message: 'O valor de aquisição não pode ser negativo' })
  @ApiProperty()
  acquisitionValue: number;

  @IsOptional()
  @IsUUID('all', { message: 'Grupo não encontrado' })
  @ApiProperty({ required: false })
  groupId?: string | null;
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'A vida útil precisa ser maior que zero' })
  @ApiProperty({ required: false })
  usefulLifeMonths?: number;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'O residual é um percentual com até duas casas' },
  )
  @Min(0, { message: 'O residual precisa ficar entre 0 e 100%' })
  @Max(100, { message: 'O residual precisa ficar entre 0 e 100%' })
  @ApiProperty({ required: false })
  residualPercent?: number;

  // Passar de detalhado para simplificado com configuração usada em
  // composição pede a confirmação (P-16)
  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  confirmed?: boolean;
}

export class ToggleAssetDto {
  @IsBoolean()
  @ApiProperty()
  active: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  @ApiProperty({ required: false })
  reason?: string;
}

export class SellAssetDto {
  @IsInt({ message: 'O valor da venda vai em centavos' })
  @Min(0, { message: 'O valor da venda não pode ser negativo' })
  @ApiProperty()
  value: number;

  @IsDateString({}, { message: 'Data da venda inválida' })
  @ApiProperty({ example: '2026-10-07' })
  date: string;

  // A conta de receita do plano de contas (subcategoria)
  @IsUUID('all', { message: 'Escolha a conta de receita' })
  @ApiProperty()
  financialNatureId: string;

  @IsOptional()
  @IsUUID('all', { message: 'Conta bancária não encontrada' })
  @ApiProperty({ required: false })
  bankAccountId?: string;
}

export class AssetCostDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do custo' })
  @MaxLength(120)
  @ApiProperty()
  name: string;

  @IsEnum(AssetCostNature, { message: 'Natureza do custo inválida' })
  @ApiProperty({ enum: AssetCostNature })
  nature: AssetCostNature;

  @IsInt({ message: 'O custo vai em centavos' })
  @Min(0, { message: 'O custo não pode ser negativo' })
  @ApiProperty()
  unitCost: number;

  @IsNumber()
  @Min(0.0001, { message: 'O rendimento precisa ser maior que zero' })
  @ApiProperty()
  yieldAmount: number;

  @IsEnum(AssetYieldUnit, { message: 'Rendimento inválido' })
  @ApiProperty({ enum: AssetYieldUnit })
  yieldUnit: AssetYieldUnit;

  // A conta do plano de contas (subcategoria) do custo
  @IsOptional()
  @IsUUID('all', { message: 'Conta não encontrada' })
  @ApiProperty({ required: false })
  financialNatureId?: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'Data inválida' })
  @ApiProperty({ required: false })
  lastOccurrence?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Configuração não encontrada' })
  @ApiProperty({ required: false })
  setupId?: string | null;
}

export class UpdateAssetCostDto extends PartialType(AssetCostDto) {}

export class AssetSetupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da configuração' })
  @MaxLength(80)
  @ApiProperty()
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  @ApiProperty({ required: false })
  abbreviation?: string;

  @IsEnum(AssetUnit, { message: 'Unidade inválida' })
  @ApiProperty({ enum: AssetUnit })
  unit: AssetUnit;

  @IsNumber()
  @Min(0, { message: 'O tempo por unidade não pode ser negativo' })
  @ApiProperty({ description: 'minutos por unidade' })
  timePerUnit: number;

  @IsNumber()
  @Min(0.0001, { message: 'A produtividade precisa ser maior que zero' })
  @ApiProperty()
  monthlyProductivity: number;
}

export class UpdateAssetSetupDto extends PartialType(AssetSetupDto) {}

export class CreateAssetGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do grupo' })
  @MaxLength(80)
  @ApiProperty()
  name: string;

  @IsEnum(AssetUnit, { message: 'Unidade inválida' })
  @ApiProperty({ enum: AssetUnit })
  unit: AssetUnit;

  @IsUUID('all', { message: 'Setor não encontrado' })
  @ApiProperty()
  sectorId: string;
}

export class RenameAssetGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do grupo' })
  @MaxLength(80)
  @ApiProperty()
  name: string;
}

export class GroupFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiProperty({ required: false })
  limit?: number;
}

export class ReadingFilterDto extends GroupFilterDto {}

/** A leitura do contador do bem, na unidade dele, no dia. */
export class AssetReadingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data da leitura inválida' })
  @IsDateString({}, { message: 'Data da leitura inválida' })
  @ApiProperty({ example: '2026-10-20' })
  date: string;

  @IsNumber({}, { message: 'Informe o que o contador marca' })
  @Min(0, { message: 'A leitura não pode ser negativa' })
  @ApiProperty({ description: 'o contador, na unidade do bem' })
  value: number;
}

/** As contas do plano: despesa para o custo do bem, receita para a venda. */
export class AssetAccountsDto {
  @IsIn(['payable', 'receivable'], { message: 'Tipo de conta inválido' })
  type: 'payable' | 'receivable';
}

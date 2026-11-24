import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Veículos, fase 1 (Maicol, 23/11/2026, ELITE). */
export class TripStopDto {
  @ApiProperty({ enum: ['WORK', 'FREE'] })
  @IsIn(['WORK', 'FREE'])
  kind: 'WORK' | 'FREE';

  /** A tarefa da produção (instalação, entrega, retirada) */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Tarefa não encontrada' })
  taskId?: string;

  /** A parada livre: banco, cartório, buscar material, levar alguém */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Setor não encontrado' })
  sectorId?: string;
}

export class CreateTripDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Veículo não encontrado' })
  vehicleId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  teamIds?: string[];

  @ApiProperty({ example: '2026-11-24T08:00:00-03:00' })
  @IsDateString({}, { message: 'Informe a partida' })
  departAt: string;

  @ApiProperty({ example: '2026-11-24T18:00:00-03:00' })
  @IsDateString({}, { message: 'Informe a volta' })
  returnAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ type: [TripStopDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TripStopDto)
  stops: TripStopDto[];

  /** Os pedidos de veículo encaixados nesta saída (viram paradas livres) */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  requestIds?: string[];
}

export class StartTripDto {
  @ApiPropertyOptional({ description: 'O odômetro na saída' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  odometerStart?: number;
}

export class StopResultDto {
  @ApiProperty({ enum: ['DONE', 'NOT_DONE'] })
  @IsIn(['DONE', 'NOT_DONE'])
  status: 'DONE' | 'NOT_DONE';

  @ApiPropertyOptional({ description: 'Não feito: cliente ausente, chuva…' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class StopAllocationDto {
  @ApiProperty()
  @IsUUID()
  stopId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  km: number;
}

export class StopCloseDto extends StopResultDto {
  @ApiProperty()
  @IsUUID()
  stopId: string;
}

export class CloseTripDto {
  @ApiPropertyOptional({ description: 'O odômetro na volta' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  odometerEnd?: number;

  @ApiPropertyOptional({ description: 'O km rodado, sem odômetro' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  km?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  finishedAt?: string;

  /** A divisão do km entre as paradas, ajustada por quem fecha */
  @ApiPropertyOptional({ type: [StopAllocationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StopAllocationDto)
  allocations?: StopAllocationDto[];

  /** O resultado das paradas ainda abertas */
  @ApiPropertyOptional({ type: [StopCloseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StopCloseDto)
  stops?: StopCloseDto[];
}

export class CancelTripDto {
  @ApiProperty()
  @IsString()
  @MaxLength(300)
  reason: string;
}

export class VehicleRequestDto {
  @ApiProperty({ description: 'Para quê: banco, visita, buscar material…' })
  @IsString()
  @MaxLength(200)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  destination?: string;

  @ApiProperty({ example: '2026-11-25' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida' })
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'Setor não encontrado' })
  sectorId?: string;
}

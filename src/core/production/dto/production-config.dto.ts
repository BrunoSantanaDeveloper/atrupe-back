import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// NONE (GP-47, 29/10/2026): sem controle de tempo, a tarefa só se conclui
export const TIME_MODES = ['PLAY_STOP', 'DRAG_DROP', 'NONE'] as const;
export const RELEASE_RULES = ['AFTER_BASE', 'WITH_BASE', 'DONE'] as const;
export const ACCESS_LEVELS = ['NONE', 'ALL', 'ASSIGNED'] as const;
export const ROLES = ['OPERATOR', 'MANAGER'] as const;
export const LIVE_SCHEDULES = ['WARN', 'RESCHEDULE'] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HHMM_MESSAGE = 'Informe o horário como 08:00';

/** O gerenciador (GP-15, GP-20, GP-43). Nome e setor, o serviço confere. */
export class ManagerDto {
  @ApiProperty({ example: 'Impressão' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  sectorId?: string;

  @ApiPropertyOptional({ description: 'Sem ele, o fluxo da empresa' })
  @IsOptional()
  @IsString()
  flowId?: string;

  @ApiProperty({ enum: TIME_MODES })
  @IsIn(TIME_MODES, { message: 'Escolha como o tempo é apontado' })
  timeMode: (typeof TIME_MODES)[number];

  @ApiProperty({ example: 10 })
  @IsOptional()
  @IsInt({ message: 'O intervalo é um número inteiro de minutos' })
  @Min(0, { message: 'O intervalo não pode ser negativo' })
  intervalMinutes?: number;

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Sem ele, o da empresa',
  })
  @IsOptional()
  @Matches(HHMM, { message: HHMM_MESSAGE })
  workStart?: string | null;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @Matches(HHMM, { message: HHMM_MESSAGE })
  workEnd?: string | null;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @Matches(HHMM, { message: HHMM_MESSAGE })
  breakStart?: string | null;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(HHMM, { message: HHMM_MESSAGE })
  breakEnd?: string | null;

  @ApiPropertyOptional({
    description: 'A máquina segue trabalhando no intervalo',
  })
  @IsOptional()
  @IsBoolean()
  runsThroughBreak?: boolean;

  @ApiPropertyOptional({ enum: LIVE_SCHEDULES })
  @IsOptional()
  @IsIn(LIVE_SCHEDULES, { message: 'Escolha como a agenda reage ao atraso' })
  liveSchedule?: (typeof LIVE_SCHEDULES)[number];

  @ApiPropertyOptional({ example: 30, description: 'Ex.: secagem' })
  @IsOptional()
  @IsInt({ message: 'O tempo após a conclusão é um número inteiro de minutos' })
  @Min(0, { message: 'O tempo após a conclusão não pode ser negativo' })
  @Max(10080, { message: 'O tempo após a conclusão vai até 7 dias' })
  afterDoneMinutes?: number;
}

export class InactivateManagerDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  destinationId?: string;
}

export class ManagerUserDto {
  @ApiProperty({ enum: ACCESS_LEVELS })
  @IsIn(ACCESS_LEVELS, { message: 'Escolha o acesso' })
  access: (typeof ACCESS_LEVELS)[number];
}

export class CollaboratorRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES, { message: 'Escolha operador ou gerente' })
  role: (typeof ROLES)[number];
}

/** O tipo de tarefa; o gerenciador só na criação (a primeira etapa). */
export class TaskTypeDto {
  @ApiProperty({ example: 'Impressão' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty({ enum: RELEASE_RULES })
  @IsIn(RELEASE_RULES, { message: 'Escolha quando a tarefa é liberada' })
  release: (typeof RELEASE_RULES)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  timeControl?: boolean;

  @ApiPropertyOptional({ description: 'Só ao criar' })
  @IsOptional()
  @IsString()
  managerId?: string;
}

export class ToggleActiveDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;
}

export class TaskStepDto {
  @ApiProperty({ example: 'Refile' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  managerId?: string;
}

export class StepOrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  stepIds: string[];
}

/** O expediente da produção (§4.8): dias, horário e feriados. */
export class CalendarDto {
  @ApiProperty({ example: [1, 2, 3, 4, 5], description: '0 = domingo' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Escolha ao menos um dia de trabalho' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workDays: number[];

  @ApiProperty({ example: '08:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'Horário de início inválido',
  })
  startTime: string;

  @ApiProperty({ example: '18:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário de fim inválido' })
  endTime: string;

  @ApiPropertyOptional({ example: ['2026-11-02'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    each: true,
    message: 'Feriado com data inválida',
  })
  holidays?: string[];

  @ApiPropertyOptional({
    example: '12:00',
    description: 'Vazio = sem intervalo',
  })
  @IsOptional()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/, {
    message: 'Início do intervalo inválido',
  })
  breakStart?: string | null;

  @ApiPropertyOptional({ example: '13:00' })
  @IsOptional()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/, {
    message: 'Fim do intervalo inválido',
  })
  breakEnd?: string | null;
}

export class VehicleDto {
  @ApiProperty({ example: 'Fiorino' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: 'ABC-1D23' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  /** O patrimônio do veículo (VE-1); nulo desliga */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assetId?: string | null;
}

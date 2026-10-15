import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const TIME_MODES = ['PLAY_STOP', 'DRAG_DROP'] as const;
export const RELEASE_RULES = ['AFTER_BASE', 'WITH_BASE', 'DONE'] as const;
export const ACCESS_LEVELS = ['NONE', 'ALL', 'ASSIGNED'] as const;
export const ROLES = ['OPERATOR', 'MANAGER'] as const;

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
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TASK_ACTIONS } from '../engine/task-machine';

export const TIME_SOURCES = ['CLOCK', 'DRAG'] as const;
export const ATTACHMENT_KINDS = ['ART', 'CUT', 'PHOTO', 'OTHER'] as const;
export const PROJECT_STATUSES = [
  'STANDBY',
  'PRODUCTION',
  'DONE',
  'CANCELED',
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class TaskActionDto {
  @ApiProperty({ enum: TASK_ACTIONS })
  @IsIn(TASK_ACTIONS, { message: 'Ação inválida' })
  action: (typeof TASK_ACTIONS)[number];

  @ApiPropertyOptional({ description: 'Liga o relógio de quem faz' })
  @IsOptional()
  @IsString()
  collaboratorId?: string;
}

export class PendencyDto {
  @ApiProperty()
  @IsOptional()
  @IsString({ message: 'Escreva a pendência' })
  @MaxLength(500, { message: 'A pendência tem até 500 letras' })
  text?: string;
}

/** O comentário da equipe (VS-5): texto livre, no histórico da tarefa. */
export class TaskCommentDto {
  @ApiProperty()
  // A tela não limita o tamanho: sem a mensagem, o 400 saía em inglês
  @IsString({ message: 'Escreva o comentário' })
  @MaxLength(1000, { message: 'O comentário tem até 1.000 letras' })
  text: string;
}

export const TASK_PRIORITIES = ['NORMAL', 'URGENT'] as const;

export class ReleaseNextDto {
  @ApiPropertyOptional({ description: 'Quantas unidades vão (opcional)' })
  @IsOptional()
  @IsInt({ message: 'A quantidade é um número inteiro' })
  quantity?: number | null;
}

export class TaskScheduleValueDto {
  @ApiProperty({ example: '2026-10-08' })
  @Matches(DAY, { message: 'Data inválida' })
  date: string;

  /** Sem a hora, a tarefa fica agendada só no dia (GP-49) */
  @ApiPropertyOptional({ example: '08:30', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido' })
  start?: string | null;

  /** Sem a hora, opcional: vale o tempo previsto da tarefa */
  @ApiPropertyOptional({ example: 60 })
  @IsOptional()
  @IsNumber({}, { message: 'Informe os minutos' })
  minutes?: number | null;
}

export class TaskScheduleDto {
  @ApiProperty({ type: TaskScheduleValueDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskScheduleValueDto)
  schedule: TaskScheduleValueDto | null;
}

/** Atribuir e reservar veículo; null tira. Os campos são parciais. */
export class UpdateTaskDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vehicleId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({}, { message: 'Os km são um número' })
  @Min(0, { message: 'Os km não podem ser negativos' })
  km?: number | null;

  // Urgente sobe na fila do setor (GP-47, item 4)
  @ApiPropertyOptional({ enum: TASK_PRIORITIES })
  @IsOptional()
  @IsIn(TASK_PRIORITIES, { message: 'Prioridade inválida' })
  priority?: (typeof TASK_PRIORITIES)[number];
}

export class WorkStartDto {
  @ApiProperty()
  @IsString()
  collaboratorId: string;

  @ApiPropertyOptional({ enum: TIME_SOURCES, default: 'CLOCK' })
  @IsOptional()
  @IsIn(TIME_SOURCES)
  source?: (typeof TIME_SOURCES)[number];
}

export class WorkStopDto {
  @ApiProperty()
  @IsString()
  collaboratorId: string;
}

export class TimeEntryDto {
  @ApiProperty({ example: 25 })
  @IsNumber({}, { message: 'Informe o tempo' })
  minutes: number;

  @ApiProperty()
  @IsString()
  collaboratorId: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AttachmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ATTACHMENT_KINDS })
  @IsOptional()
  @IsIn(ATTACHMENT_KINDS, { message: 'Tipo de anexo inválido' })
  kind?: (typeof ATTACHMENT_KINDS)[number];
}

/** O pedido do link de envio direto (GP-48 item 27). */
export class UploadLinkDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({
    description: 'Tamanho em bytes, conferido de novo ao receber',
  })
  @IsInt()
  @Min(1)
  size: number;
}

/** O arquivo que o navegador já enviou ao armazenamento. */
export class DirectFileDto {
  @ApiProperty()
  @IsString()
  @MaxLength(400)
  key: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mime?: string;
}

export class DirectAttachmentDto extends DirectFileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ATTACHMENT_KINDS })
  @IsOptional()
  @IsIn(ATTACHMENT_KINDS, { message: 'Tipo de anexo inválido' })
  kind?: (typeof ATTACHMENT_KINDS)[number];
}

export class CurrentVersionDto {
  @ApiProperty()
  @IsInt()
  version: number;
}

export class ProjectFilterDto {
  @ApiPropertyOptional({ enum: PROJECT_STATUSES })
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: (typeof PROJECT_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class DeliveryDto {
  @ApiProperty({ example: '2026-10-12' })
  @IsOptional()
  @IsString()
  due?: string;
}

export class PeriodDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Matches(DAY, { message: 'Data inválida' })
  to?: string;
}

/** A limpeza do espaço dos arquivos (GP-49): a porcentagem a liberar. */
export class CleanupDto {
  @ApiProperty({ example: 50, description: '% do espaço usado a liberar' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  percent: number;

  @ApiProperty({ example: 'APAGAR', description: 'A confirmação digitada' })
  @IsString()
  confirm: string;
}

/** A limpeza automática (GP-49), desligada de partida. */
export class CleanupAutoDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(1)
  @Max(100)
  percent: number;

  @ApiProperty({ example: 90, description: 'A partir de quanto do espaço' })
  @IsInt()
  @Min(50)
  @Max(100)
  threshold: number;
}

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProductionStageStatus } from '@prisma/client';

/** A troca de estado da etapa de um item (área 9 §4.7, GP-28). */
export class UpdateItemStageDto {
  @ApiProperty({ enum: ProductionStageStatus })
  @IsEnum(ProductionStageStatus)
  status: ProductionStageStatus;

  @IsOptional()
  @ApiProperty({ required: false, description: 'A pendência, descrita' })
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Concluir tudo de uma vez (gerencial, §4.7): as agendas escolhidas. */
export class FinishAllStagesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  scheduleIds: string[];
}

/** O ícone livre acrescentado no pedido, pela agenda (área 9 §4.16) */
export class AddScheduleStageDto {
  @IsUUID()
  @ApiProperty({ description: 'Setor (etapa de produção) a acrescentar' })
  stageId: string;
}

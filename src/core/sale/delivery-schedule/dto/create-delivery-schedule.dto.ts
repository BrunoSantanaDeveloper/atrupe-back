import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DeliveryScheduleStatus } from '@prisma/client'; // Importa os enums gerados pelo Prisma

export class CreateDeliveryScheduleDto {
  @ApiProperty({
    description: 'Status da entrega',
    enum: DeliveryScheduleStatus,
    example: DeliveryScheduleStatus.IN_PRODUCTION,
  })
  @IsEnum(DeliveryScheduleStatus)
  status: DeliveryScheduleStatus;

  @ApiProperty({ description: 'Entrega concluída?', example: false })
  @IsBoolean()
  completed: boolean;

  @ApiProperty({
    description: 'Notas adicionais',
    example: 'Entrega prioritária',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Data agendada para entrega',
    example: '2024-12-01T12:00:00Z',
  })
  @IsDateString()
  scheduledDate: string;

  @ApiProperty({
    description: 'Adicionar tempo ao agendamento?',
    example: false,
  })
  @IsBoolean()
  addScheduleTime: boolean;

  @ApiProperty({
    description: 'Descrição do pendente',
    example: 'Aguardando aprovação',
    required: false,
  })
  @IsOptional()
  @IsString()
  pendingDescription?: string;

  @ApiProperty({
    description: 'ID da ordem relacionada',
    example: 'uuid-order-id',
  })
  @IsUUID()
  orderId: string;
}

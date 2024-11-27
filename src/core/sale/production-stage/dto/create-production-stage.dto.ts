import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProductionStageStatus } from '@prisma/client'; // Importa os enums gerados pelo Prisma

export class CreateProductionStageDto {
  @ApiProperty({ description: 'Estágio da produção', example: 'Montagem' })
  @IsString()
  stage: string;

  @ApiProperty({
    description: 'Status do estágio',
    enum: ProductionStageStatus,
    example: ProductionStageStatus.NOT_STARTED,
  })
  @IsEnum(ProductionStageStatus)
  status: ProductionStageStatus;

  @ApiProperty({
    description: 'Status anterior',
    example: 'PENDING',
    required: false,
  })
  @IsOptional()
  @IsString()
  prevStatus?: string;

  @ApiProperty({
    description: 'ID do agendamento relacionado',
    example: 'uuid-delivery-schedule-id',
  })
  @IsUUID()
  scheduleId: string;
}

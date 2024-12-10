import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProductionStageStatus } from '@prisma/client'; // Importa os enums gerados pelo Prisma

export class CreateProductionStageDto {
  @IsOptional()
  @ApiProperty({ description: 'Estágio da produção', example: 'Montagem' })
  @IsUUID()
  stageId?: string; // Certifique-se de que isso é opcional, pois o campo no Prisma é nullable

  @IsOptional()
  @ApiProperty({
    description: 'Status do estágio',
    enum: ProductionStageStatus,
    example: ProductionStageStatus.NOT_STARTED,
  })
  @IsEnum(ProductionStageStatus)
  status?: ProductionStageStatus = ProductionStageStatus.NOT_STARTED;

  @IsOptional()
  @ApiProperty({
    description: 'Status anterior',
    example: 'PENDING',
    required: false,
  })
  @IsString()
  prevStatus?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Observação ou pendência',
    example: 'Deu ruim aqui na produção',
  })
  @IsString()
  notes?: string;
}

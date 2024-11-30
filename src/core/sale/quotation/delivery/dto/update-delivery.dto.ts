import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsDate,
  IsNumber,
  IsUUID,
} from 'class-validator';

export class UpdateDeliveryInfoDto {
  @ApiProperty({
    description: 'ID do tipo de entrega',
    type: String,
    example: 'f3a4d45d-7c75-4a9b-9edb-03d222dedb2e',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  deliveryTypeId?: string;

  @ApiProperty({
    description: 'Número de dias após a aprovação para a entrega',
    type: Number,
    required: false,
  })
  @IsInt()
  @IsOptional()
  daysAfterApproval?: number;

  @ApiProperty({
    description: 'Data estimada para a entrega',
    type: String,
    required: false,
  })
  @IsDate()
  @IsOptional()
  estimatedDate?: Date;

  @ApiProperty({
    description: 'Modalidade de entrega',
    type: String,
    default: 'Indefinida',
    required: false,
  })
  @IsString()
  @IsOptional()
  modality?: string;

  @ApiProperty({
    description: 'Custo da entrega',
    type: Number,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  cost?: number;

  @ApiProperty({
    description: 'Valor da entrega',
    type: Number,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  value?: number;

  @ApiProperty({
    description: 'Observações adicionais sobre a entrega',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description:
      'ID do fornecedor (necessário se o tipo de entrega for Transportadora)',
    required: false,
  })
  @IsOptional()
  supplierId?: string;
}

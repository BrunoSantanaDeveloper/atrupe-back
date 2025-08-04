import { ApiProperty } from '@nestjs/swagger';
import { DeliveryType } from '@prisma/client';
import {
  IsInt,
  IsOptional,
  IsString,
  IsDate,
  IsNumber,
  IsEnum,
} from 'class-validator';

export class CreateDeliveryInfoDto {
  @ApiProperty({
    description: 'ID do tipo de entrega',
    type: String,
    example: 'CARRIER',
  })
  @IsEnum(DeliveryType)
  deliveryType: DeliveryType;

  @ApiProperty({
    description: 'Número de dias após a aprovação para a entrega',
    type: Number,
  })
  @IsInt()
  daysAfterApproval: number;

  @ApiProperty({
    description: 'Data estimada para a entrega',
    type: String,
    example: '2024-12-15T10:00:00Z',
  })
  @IsDate()
  estimatedDate: Date;

  @ApiProperty({
    description: 'Modalidade de entrega (valor padrão é "Indefinida")',
    type: String,
    default: 'Indefinida',
  })
  @IsString()
  modality: string;

  @ApiProperty({
    description: 'Custo da entrega',
    type: Number,
  })
  @IsNumber()
  cost: number;

  @ApiProperty({
    description: 'Valor da entrega',
    type: Number,
  })
  @IsNumber()
  value: number;

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

  @ApiProperty({
    description: 'ID do endereço do cliente para entrega',
    required: false,
  })
  @IsOptional()
  @IsString()
  clientAddressId?: string;
}

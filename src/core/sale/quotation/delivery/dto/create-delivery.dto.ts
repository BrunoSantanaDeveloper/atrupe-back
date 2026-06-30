import { ApiProperty } from '@nestjs/swagger';
import { DeliveryType } from '@prisma/client';
import {
  IsInt,
  IsOptional,
  IsString,
  IsDate,
  IsNumber,
  IsEnum,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomAddressDto } from './custom-address.dto';

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
    description: 'Horário de entrega no formato HH:MM (ex: 14:00)',
    required: false,
  })
  @IsOptional()
  @IsString()
  deliveryTime?: string;

  @ApiProperty({
    description:
      'Modo de exibição do prazo no PDF: DAYS (em dias) ou DATE (data exata)',
    required: false,
    enum: ['DAYS', 'DATE'],
    default: 'DAYS',
  })
  @IsOptional()
  @IsString()
  deliveryDisplayMode?: string;

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

  @ApiProperty({
    description:
      'Endereço customizado para entrega (usado quando clientAddressId é "custom")',
    required: false,
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomAddressDto)
  customAddress?: CustomAddressDto;
}

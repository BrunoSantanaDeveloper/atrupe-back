import { ApiProperty } from '@nestjs/swagger';
import { DeliveryType } from '@prisma/client';
import {
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomAddressDto } from './custom-address.dto';

export class UpdateDeliveryInfoDto {
  @ApiProperty({
    description: 'ID do tipo de entrega',
    type: String,
    example: 'CARRIER',
    required: false,
  })
  @IsOptional()
  @IsEnum(DeliveryType)
  deliveryType?: DeliveryType;

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
    type: Date,
    required: false,
  })
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
    properties: {
      zipcode: { type: 'string', description: 'CEP' },
      state: { type: 'string', description: 'Estado' },
      city: { type: 'string', description: 'Cidade' },
      neighborhood: { type: 'string', description: 'Bairro' },
      street: { type: 'string', description: 'Rua' },
      number: { type: 'string', description: 'Número' },
      complement: { type: 'string', description: 'Complemento' },
    },
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomAddressDto)
  customAddress?: CustomAddressDto;
}

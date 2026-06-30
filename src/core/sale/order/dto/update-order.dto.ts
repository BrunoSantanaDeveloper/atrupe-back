import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}

export class UpdateOrderDeliveryAddressDto {
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zipcode?: string;
}

export class UpdateOrderInfoDto {
  @IsOptional()
  @IsUUID()
  @ApiProperty({ description: 'Novo cliente da OS', required: false })
  clientId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({ description: 'Novo vendedor da OS', required: false })
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Novo responsável (contato do cliente)',
    required: false,
  })
  contactId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description:
      'ID do endereço de entrega do cliente, ou "custom" para endereço personalizado',
    required: false,
  })
  deliveryClientAddressId?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateOrderDeliveryAddressDto)
  @ApiProperty({
    description: 'Endereço personalizado de entrega',
    required: false,
  })
  deliveryCustomAddress?: UpdateOrderDeliveryAddressDto;
}

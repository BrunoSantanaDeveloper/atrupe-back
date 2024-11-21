import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Rua', required: false })
  street?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Número', required: false })
  number?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Complemento', required: false })
  complement?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Bairro', required: false })
  neighborhood?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({ description: 'ID da cidade', required: false })
  cityId?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({ description: 'ID do estado', required: false })
  stateId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'País', required: false })
  country?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'CEP', required: false })
  zipcode?: string;
}

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { CreateAddressDto } from '../../address/dto/create-address.dto';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCompanyDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da empresa',
    required: true,
    example: 'Tech Innovators Ltda',
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @IsCnpj()
  @ApiProperty({
    description: 'CNPJ da empresa',
    required: true,
    example: '12.345.678/0001-99',
  })
  cnpj: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Razão social',
    required: false,
    example: 'Tech Innovators',
  })
  legalName?: string; // Razão Social

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Inscrição Estadual',
    required: false,
    example: '123456789',
  })
  stateRegistration?: string; // Inscrição Estadual (opcional)

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Inscrição Municipal',
    required: false,
    example: '987654321',
  })
  municipalRegistration?: string; // Inscrição Municipal (opcional)

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone',
    required: false,
    example: '+55 11 1234-5678',
  })
  phoneNumber?: string; // Telefone (opcional)

  @IsOptional()
  @IsUrl()
  @ApiProperty({
    description: 'Site',
    required: false,
    example: 'https://www.techinnovators.com',
  })
  website?: string; // Site (opcional)

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  @ApiProperty({
    description: 'Endereço',
    required: false,
    example: {
      street: 'Rua das Inovações, 123',
      cityId: '16d23eb1-6763-46e3-b2a2-7b1a05037768',
      stateId: '16d23eb1-6763-46e3-b2a2-7b1a05037768',
      zipCode: '12345-678',
      country: 'Brasil',
    },
  })
  address?: CreateAddressDto;
}

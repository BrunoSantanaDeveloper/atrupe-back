import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
  IsEmail,
} from 'class-validator';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAddressDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'CEP',
    required: true,
    example: '12345-678',
  })
  zipcode: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Estado',
    required: true,
    example: 'São Paulo',
  })
  state: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Cidade',
    required: true,
    example: 'São Paulo',
  })
  city: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Bairro',
    required: true,
    example: 'Centro',
  })
  neighborhood: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Rua',
    required: true,
    example: 'Rua das Inovações',
  })
  street: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Número',
    required: true,
    example: '123',
  })
  number: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Complemento',
    required: false,
    example: 'Sala 456',
  })
  complement?: string;
}

export class CreateGeneralInfoDto {
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
  @ApiProperty({
    description: 'Razão social',
    required: true,
    example: 'Tech Innovators',
  })
  legalName: string;

  @IsNotEmpty()
  @IsString()
  @IsCnpj()
  @ApiProperty({
    description: 'CNPJ da empresa',
    required: true,
    example: '12.345.678/0001-99',
  })
  cnpj: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'Email',
    required: true,
    example: 'contato@techinnovators.com',
  })
  email: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({
    description: 'Site',
    required: false,
    example: 'https://www.techinnovators.com',
  })
  siteUrl?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone fixo',
    required: false,
    example: '+55 11 1234-5678',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Telefone celular',
    required: false,
    example: '+55 11 98765-4321',
  })
  mobile?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Inscrição Municipal',
    required: false,
    example: '987654321',
  })
  municipalRegistration?: string;
}

export class CreatePersonalizationDto {
  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'URL do logo',
    required: false,
    example: 'https://example.com/logo.png',
  })
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'URL do favicon',
    required: false,
    example: 'https://example.com/favicon.ico',
  })
  favIconUrl?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Textos antes dos itens',
    required: false,
    example: 'Observações importantes:',
  })
  textsBeforeItems?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Textos depois dos itens',
    required: false,
    example: 'Agradecemos a preferência!',
  })
  textsAfterItems?: string;
}

export class CreateCompanyDto {
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateGeneralInfoDto)
  @ApiProperty({
    description: 'Informações gerais',
    required: true,
    type: () => CreateGeneralInfoDto,
  })
  general: CreateGeneralInfoDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  @ApiProperty({
    description: 'Endereço',
    required: true,
    type: () => CreateAddressDto,
  })
  address: CreateAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePersonalizationDto)
  @ApiProperty({
    description: 'Personalização',
    required: false,
    type: () => CreatePersonalizationDto,
  })
  personalization?: CreatePersonalizationDto;
}

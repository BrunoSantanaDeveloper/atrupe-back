import { IsOptional, ValidateNested, IsBoolean } from 'class-validator';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { Type, Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAddressDto {
  @IsOptional()
  @ApiProperty({
    description: 'CEP',
    required: true,
    example: '12345-678',
  })
  zipcode: string;

  @IsOptional()
  @ApiProperty({
    description: 'Estado',
    required: true,
    example: 'São Paulo',
  })
  state: string;

  @IsOptional()
  @ApiProperty({
    description: 'Cidade',
    required: true,
    example: 'São Paulo',
  })
  city: string;

  @IsOptional()
  @ApiProperty({
    description: 'Bairro',
    required: true,
    example: 'Centro',
  })
  neighborhood: string;

  @IsOptional()
  @ApiProperty({
    description: 'Rua',
    required: true,
    example: 'Rua das Inovações',
  })
  street: string;

  @IsOptional()
  @ApiProperty({
    description: 'Número',
    required: true,
    example: '123',
  })
  number: string;

  @IsOptional()
  @ApiProperty({
    description: 'Complemento',
    required: false,
    example: 'Sala 456',
  })
  complement?: string;
}

export class CreateGeneralInfoDto {
  @IsOptional()
  @ApiProperty({
    description: 'Nome da empresa',
    required: true,
    example: 'Tech Innovators Ltda',
  })
  name: string;

  @IsOptional()
  @ApiProperty({
    description: 'Razão social',
    required: true,
    example: 'Tech Innovators',
  })
  legalName: string;

  @IsOptional()
  @Transform(({ value }) =>
    !value || value.trim() === '' ? undefined : value.trim(),
  )
  @IsCnpj()
  @ApiProperty({
    description: 'CNPJ da empresa',
    required: true,
    example: '12.345.678/0001-99',
  })
  cnpj: string;

  @IsOptional()
  @ApiProperty({
    description: 'Email',
    required: true,
    example: 'contato@techinnovators.com',
  })
  email: string;

  @IsOptional()
  @ApiProperty({
    description: 'Site',
    required: false,
    example: 'https://www.techinnovators.com',
  })
  siteUrl?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Telefone fixo',
    required: false,
    example: '+55 11 1234-5678',
  })
  phone?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Telefone celular',
    required: false,
    example: '+55 11 98765-4321',
  })
  mobile?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Inscrição Estadual',
    required: false,
    example: '123456789',
  })
  stateRegistration?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Inscrição Municipal',
    required: false,
    example: '987654321',
  })
  municipalRegistration?: string;
}

export class CreatePersonalizationDto {
  @IsOptional()
  @ApiProperty({
    description: 'URL do logo',
    required: false,
    example: 'https://example.com/logo.png',
  })
  logoUrl?: string;

  @IsOptional()
  @ApiProperty({
    description: 'URL do favicon',
    required: false,
    example: 'https://example.com/favicon.ico',
  })
  favIconUrl?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Textos antes dos itens',
    required: false,
    example: 'Observações importantes:',
  })
  textsBeforeItems?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Textos depois dos itens',
    required: false,
    example: 'Agradecemos a preferência!',
  })
  textsAfterItems?: string;
}

export class CreateSocialNetworksDto {
  @IsOptional()
  @ApiProperty({
    description: 'Instagram da empresa',
    required: false,
    example: 'minhaempresa',
  })
  instagram?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Facebook da empresa',
    required: false,
    example: 'minhaempresa',
  })
  facebook?: string;

  @IsOptional()
  @ApiProperty({
    description: 'LinkedIn da empresa',
    required: false,
    example: 'minhaempresa',
  })
  linkedin?: string;
}

export class CreateCompanyDto {
  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Ativo',
    required: false,
    example: true,
  })
  isActive?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGeneralInfoDto)
  @ApiProperty({
    description: 'Informações gerais',
    required: true,
    type: () => CreateGeneralInfoDto,
  })
  general: CreateGeneralInfoDto;

  @IsOptional()
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

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSocialNetworksDto)
  @ApiProperty({
    description: 'Redes sociais',
    required: false,
    type: () => CreateSocialNetworksDto,
  })
  socialNetworks?: CreateSocialNetworksDto;
}

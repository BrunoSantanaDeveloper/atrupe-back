import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  IsEmail,
  IsArray,
  IsBoolean,
  IsNumber,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { ClientKind } from '@prisma/client';
import { IsCpf } from '../../../helpers/validators/cpf';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class GeneralInfoDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  corporateName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @ValidateIf((o) => o.type === ClientKind.PERSON)
  @IsCpf()
  cpf?: string;

  @ValidateIf((o) => o.type === ClientKind.PERSON)
  @IsString()
  rg?: string;

  @ValidateIf((o) => o.type === ClientKind.COMPANY)
  @IsCnpj()
  cnpj?: string;

  @IsOptional()
  @IsString()
  activity?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class AddressDto {
  @IsString()
  type: string;

  @IsString()
  zipcode: string;

  @IsString()
  state: string;

  @IsString()
  city: string;

  @IsString()
  neighborhood: string;

  @IsString()
  street: string;

  @IsString()
  number: string;

  @IsOptional()
  @IsString()
  complement?: string;
}

class ContactDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PaymentConditionDto {
  @IsUUID()
  id: string;

  @IsBoolean()
  isActive: boolean;
}

class CreditLimitDto {
  @IsNumber()
  minValue: number;

  @IsNumber()
  maxValue: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentConditionDto)
  conditions: PaymentConditionDto[];

  @IsBoolean()
  blockClient: boolean;
}

export class CreateClientDto {
  @IsNotEmpty()
  @IsEnum(ClientKind)
  type: ClientKind;

  @ValidateNested()
  @Type(() => GeneralInfoDto)
  general: GeneralInfoDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressDto)
  addresses: AddressDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[];

  @ValidateNested()
  @Type(() => CreditLimitDto)
  creditLimit: CreditLimitDto;

  companyId: string;
}

export class PreRegisterClientDto {
  @ApiProperty({
    enum: ClientKind,
    description: 'Tipo do cliente (PERSON ou COMPANY)',
    example: 'PERSON',
  })
  @IsEnum(ClientKind)
  type: ClientKind;

  @ApiProperty({
    description: 'Nome do cliente',
    example: 'João Silva',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Email do cliente',
    example: 'joao.silva@email.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Categoria do cliente',
    required: false,
    example: 'VIP',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'RG (apenas para pessoa física)',
    required: false,
    example: '12.345.678-9',
  })
  @IsOptional()
  @IsString()
  rg?: string;

  @ApiProperty({
    description: 'CPF (apenas para pessoa física)',
    required: false,
    example: '123.456.789-00',
  })
  @IsOptional()
  @IsString()
  cpf?: string;

  @ApiProperty({
    description: 'CNPJ (apenas para pessoa jurídica)',
    required: false,
    example: '12.345.678/0001-90',
  })
  @IsOptional()
  @IsString()
  cnpj?: string;

  @ApiProperty({
    description: 'Ramo de atividade (apenas para pessoa jurídica)',
    required: false,
    example: 'Comércio Varejista',
  })
  @IsOptional()
  @IsString()
  activity?: string;

  @ApiProperty({
    description: 'Nome fantasia (apenas para pessoa jurídica)',
    required: false,
    example: 'Mercado do João',
  })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiProperty({
    description: 'Razão social (apenas para pessoa jurídica)',
    required: false,
    example: 'João Comércio de Alimentos LTDA',
  })
  @IsOptional()
  @IsString()
  corporateName?: string;

  @ApiProperty({
    description: 'Telefone fixo',
    example: '(11) 3333-4444',
  })
  @IsString()
  phone: string;

  @ApiProperty({
    description: 'Telefone celular',
    required: false,
    example: '(11) 98888-7777',
  })
  @IsOptional()
  @IsString()
  mobile?: string;

  companyId: string;
}

import {
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  IsArray,
  IsBoolean,
  IsNumber,
  ValidateNested,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { ClientKind, ClientStatus } from '@prisma/client';
import { IsCpf } from '../../../helpers/validators/cpf';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class GeneralInfoDto {
  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  corporateName?: string;

  @IsOptional()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @ValidateIf((o) => o.categoryId && o.categoryId.trim() !== '')
  @IsUUID()
  categoryId?: string;

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

  @IsOptional()
  @IsDateString()
  birthdate?: string;
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
  email?: string;

  @IsOptional()
  phone?: string;

  @IsOptional()
  mobile?: string;

  @IsOptional()
  notes?: string;
}

class PaymentConditionDto {
  @IsUUID()
  @IsOptional()
  id?: string;

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
  @IsOptional()
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
  @IsOptional()
  @Type(() => CreditLimitDto)
  creditLimit: CreditLimitDto;

  companyId: string;

  @IsOptional()
  @IsEnum(ClientStatus)
  @ApiProperty({
    description: 'Status do cliente',
    example: 'ACTIVE',
  })
  status: ClientStatus;
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
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'ID da categoria do cliente',
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @ValidateIf((o) => o.categoryId && o.categoryId.trim() !== '')
  @IsUUID()
  categoryId?: string;

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
    example: '012.345.678-90',
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

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

export class CreateSupplierDto {
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

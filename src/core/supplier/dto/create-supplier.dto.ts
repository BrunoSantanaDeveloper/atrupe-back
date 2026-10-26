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
  MaxLength,
} from 'class-validator';
import { ClientKind } from '@prisma/client';
import { IsCpf } from '../../../helpers/validators/cpf';
import { IsCnpj } from '../../../helpers/validators/cnpj';
import { Type } from 'class-transformer';

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
  @ValidateIf((o) => o.categoryId !== '' && o.categoryId !== null)
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
  @IsBoolean()
  isBranch?: boolean;
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

// Dados de pagamento do fornecedor (26/10/2026): como pagar as contas a
// pagar dele — Pix, banco, agência, conta, titular e o prazo/forma habitual
export class SupplierPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  pixKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankAgency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolder?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentTerms?: string | null;
}

export class CreateSupplierDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierPaymentDto)
  payment?: SupplierPaymentDto;

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
  @Type(() => CreditLimitDto)
  creditLimit: CreditLimitDto;

  companyId: string;
}

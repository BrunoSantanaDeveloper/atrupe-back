import { PlanType } from '@prisma/client';
import {
  IsEnum,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
} from 'class-validator';

export class CreatePlanDTO {
  @IsEnum(PlanType)
  type: PlanType;

  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsNumber()
  price: number;

  @IsBoolean()
  isActive: boolean;

  @IsString()
  companyId: string;
}

export class ListPlanDTO {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsNumber()
  price: number;

  @IsBoolean()
  isActive: boolean;

  @IsEnum(PlanType)
  type: PlanType;
}

enum BillingType {
  UNDEFINED = 'UNDEFINED',
  BOLETO = 'BOLETO',
  CREDIT_CARD = 'CREDIT_CARD',
  PIX = 'PIX',
}

enum Cycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export class SubscriptionDTO {
  @IsString()
  planId: string;

  @IsString()
  companyId: string;

  @IsNumber()
  extraUsers: number;

  @IsNumber()
  planPrice: number;

  @IsEnum(Cycle)
  cycle: Cycle;

  @IsBoolean()
  isContractAccepted: boolean;

  @IsEnum(BillingType)
  billingType: BillingType;

  @IsString()
  @IsOptional()
  customer: string;

  @IsString()
  @IsOptional()
  nextDueDate: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  cpfCnpj: string;

  @IsString()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  mobilePhone: string;

  @IsString()
  address: string;

  @IsString()
  addressNumber: string;

  @IsString()
  complement: string;

  @IsString()
  province: string;

  @IsString()
  postalCode: string;
}

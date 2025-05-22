import { ApiProperty } from '@nestjsx/crud/lib/crud';
import { PlanType } from '@prisma/client';
import {
  IsEnum,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreatePlanDTO {
  @IsEnum(PlanType)
  @ApiProperty({
    description: 'Tipo de plano',
    example: PlanType.START,
    required: true,
  })
  type: PlanType;

  @IsString()
  @ApiProperty({
    description: 'Nome do plano',
    example: 'Plano Start',
    required: true,
  })
  name: string;

  @IsString()
  @ApiProperty({
    description: 'Descrição do plano',
    example: 'Plano Start',
    required: false,
  })
  description?: string;

  @IsNumber()
  @ApiProperty({
    description: 'Preço do plano',
    example: 135,
    required: true,
  })
  price: number;

  @IsBoolean()
  @ApiProperty({
    description: 'Indica se o plano está ativo',
    example: true,
    required: true,
  })
  isActive: boolean;

  @IsString()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  companyId: string;
}

export class ListPlanDTO {
  @IsString()
  @IsUUID()
  @ApiProperty({
    description: 'ID do plano',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  id: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do plano',
    example: 'Plano Start',
    required: true,
  })
  name: string;

  @IsString()
  @ApiProperty({
    description: 'Descrição do plano',
    example: 'Plano Start',
    required: false,
  })
  description?: string;

  @IsNumber()
  @ApiProperty({
    description: 'Preço do plano',
    example: 135,
    required: true,
  })
  price: number;

  @IsBoolean()
  @ApiProperty({
    description: 'Indica se o plano está ativo',
    example: true,
    required: true,
  })
  isActive: boolean;

  @IsEnum(PlanType)
  @ApiProperty({
    description: 'Tipo de plano',
    example: PlanType.START,
    required: true,
  })
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
  @IsUUID()
  @ApiProperty({
    description: 'ID do plano',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  planId: string;

  @IsString()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  companyId: string;

  @IsNumber()
  @ApiProperty({
    description: 'Número de usuários extras',
    example: 2,
    required: false,
  })
  extraUsers?: number;

  @IsNumber()
  @ApiProperty({
    description: 'Preço do plano',
    example: 299.9,
    required: true,
  })
  planPrice: number;

  @IsEnum(Cycle)
  @ApiProperty({
    description: 'Ciclo de cobrança',
    example: Cycle.MONTHLY,
    required: true,
  })
  cycle: Cycle;

  @IsBoolean()
  @ApiProperty({
    description: 'Indica se o contrato foi aceito',
    example: true,
    required: true,
  })
  isContractAccepted: boolean;

  @IsEnum(BillingType)
  @ApiProperty({
    description: 'Tipo de cobrança',
    example: BillingType.CREDIT_CARD,
    required: true,
  })
  billingType: BillingType;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'ID do cliente',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  customer: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Data do próximo vencimento',
    example: '2024-04-15',
    required: true,
  })
  nextDueDate: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Nome do cliente',
    example: 'John Doe',
    required: true,
  })
  name: string;

  @IsString()
  @ApiProperty({
    description: 'CPF/CNPJ do cliente',
    example: '1234567890',
    required: true,
  })
  cpfCnpj: string;

  @IsString()
  @ApiProperty({
    description: 'Email do cliente',
    example: 'john.doe@example.com',
    required: true,
  })
  email: string;

  @IsString()
  @ApiProperty({
    description: 'Telefone do cliente',
    example: '1234567890',
    required: true,
  })
  phone: string;

  @IsString()
  @ApiProperty({
    description: 'Telefone do cliente',
    example: '1234567890',
    required: false,
  })
  mobilePhone?: string;

  @IsString()
  @ApiProperty({
    description: 'Endereço do cliente',
    example: 'Rua das Flores, 123',
    required: true,
  })
  address: string;

  @IsString()
  @ApiProperty({
    description: 'Número do endereço do cliente',
    example: '123/SN',
    required: false,
  })
  @IsString()
  addressNumber: string;

  @IsString()
  @ApiProperty({
    description: 'Complemento do endereço do cliente',
    example: 'Apto 123',
    required: false,
  })
  complement: string;

  @IsString()
  @ApiProperty({
    description: 'Província do endereço do cliente',
    example: 'São Paulo',
    required: true,
  })
  province: string;

  @IsString()
  @ApiProperty({
    description: 'CEP do endereço do cliente',
    example: '1234567890',
    required: true,
  })
  postalCode: string;
}

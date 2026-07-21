import { PartialType } from '@nestjs/swagger';
import { ApiProperty } from '@nestjsx/crud/lib/crud';
import {
  IsEnum,
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreatePlanDTO {
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
    example: 'Plano inicial com recursos básicos',
    required: true,
  })
  description: string;

  @IsNumber()
  @ApiProperty({
    description: 'Preço base do plano',
    example: 115.0,
    required: true,
  })
  basePrice: number;

  @IsNumber()
  @ApiProperty({
    description: 'Preço adicional por usuário',
    example: 15.0,
    required: true,
  })
  additionalUserPrice: number;

  // modules array removido - usar planFeatures relation
}

export class UpdatePlanDTO extends PartialType(CreatePlanDTO) {}

export class SetPlanAvailabilityDTO {
  @IsBoolean()
  @ApiProperty({
    description: 'Define se o plano fica disponível para contratação',
    example: true,
    required: true,
  })
  isActive: boolean;
}

export class ListPlanDTO extends CreatePlanDTO {
  @IsUUID()
  @ApiProperty({
    description: 'ID do plano',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  id: string;
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
  planId: string;
  companyId: string;

  @IsNumber()
  @IsOptional()
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

  @IsNumber()
  @IsOptional()
  @ApiProperty({
    description: 'Valor total',
    example: 299.9,
    required: false,
  })
  totalAmount?: number;

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
    required: false,
  })
  customer?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Data do próximo vencimento',
    example: '2024-04-15',
    required: false,
  })
  nextDueDate?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Nome do cliente',
    example: 'John Doe',
    required: false,
  })
  name?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'CPF/CNPJ do cliente',
    example: '1234567890',
    required: false,
  })
  cpfCnpj?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'CPF do cliente',
    example: '012.345.678-90',
    required: false,
  })
  cpf?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'CNPJ do cliente',
    example: '36.455.529/0001-47',
    required: false,
  })
  cnpj?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Nome da empresa',
    example: 'Empresa Teste',
    required: false,
  })
  companyName?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Email do cliente',
    example: 'john.doe@example.com',
    required: false,
  })
  email?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Telefone do cliente',
    example: '1234567890',
    required: false,
  })
  phone?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Telefone móvel do cliente',
    example: '1234567890',
    required: false,
  })
  mobilePhone?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Endereço do cliente',
    example: 'Rua das Flores, 123',
    required: false,
  })
  address?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Número do endereço do cliente',
    example: '123/SN',
    required: false,
  })
  addressNumber?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Complemento do endereço do cliente',
    example: 'Apto 123',
    required: false,
  })
  complement?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Estado/Província do endereço do cliente',
    example: 'São Paulo',
    required: false,
  })
  province?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'CEP do endereço do cliente',
    example: '1234567890',
    required: false,
  })
  postalCode?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Cidade do cliente',
    example: 'São Paulo',
    required: false,
  })
  city?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Bairro do cliente',
    example: 'Centro',
    required: false,
  })
  neighborhood?: string;
}

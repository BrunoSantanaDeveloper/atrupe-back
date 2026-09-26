import {
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsCpf } from 'src/helpers/validators/cpf';
import { IsCnpj } from 'src/helpers/validators/cnpj';
import {
  CARD_MAX_INSTALLMENTS,
  MAX_ADDITIONAL_USERS,
} from '../pricing/pricing.engine';

export const CHECKOUT_BILLING_TYPES = ['CREDIT_CARD', 'PIX', 'BOLETO'] as const;
export type CheckoutBillingType = (typeof CHECKOUT_BILLING_TYPES)[number];

export class CheckoutTermsDto {
  @ApiProperty()
  @IsString()
  contractId: string;

  @ApiProperty()
  @IsInt()
  version: number;

  @ApiProperty()
  @Equals(true, {
    message: 'Leia e aceite os Termos de Contratação para continuar.',
  })
  accepted: boolean;
}

/**
 * Quem contrata. Empresa pede CNPJ e e-mail corporativo; pessoa física, nome,
 * CPF e e-mail. Nada de endereço ou faturamento: o que a cobrança não exige
 * não é pedido (minimização de dados).
 */
export class CheckoutContractorDto {
  @ApiProperty({ enum: ['PJ', 'PF'] })
  @IsIn(['PJ', 'PF'])
  type: 'PJ' | 'PF';

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.type === 'PJ')
  @IsCnpj({ message: 'CNPJ inválido.' })
  cnpj?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o) => o.type === 'PF')
  @IsCpf({ message: 'CPF inválido.' })
  cpf?: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @ApiProperty({
    required: false,
    description: 'Nome completo (pessoa física)',
  })
  @ValidateIf((o) => o.type === 'PF')
  @IsString()
  @MinLength(2, { message: 'Informe o nome completo.' })
  @MaxLength(200)
  name?: string;

  @ApiProperty({
    required: false,
    description: 'Razão social, quando a consulta de CNPJ não a trouxer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradeName?: string;
}

/**
 * Quem responde legalmente pela empresa. Só o CPF (e o nome, quando o
 * registro público não o fornece): nunca e-mail ou telefone do representante.
 */
export class CheckoutRepresentativeDto {
  @ApiProperty()
  @IsCpf({ message: 'CPF do representante inválido.' })
  cpf: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ description: 'Quem está contratando é o representante' })
  @IsBoolean()
  isSelf: boolean;
}

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  planId: string;

  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], required: false })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  cycle?: 'MONTHLY' | 'YEARLY';

  @ApiProperty({
    required: false,
    description: 'Parcelas do anual no cartão (1 a 12); 1 é à vista',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CARD_MAX_INSTALLMENTS)
  installmentCount?: number;

  @ApiProperty({ enum: CHECKOUT_BILLING_TYPES })
  @IsIn(CHECKOUT_BILLING_TYPES)
  billingType: CheckoutBillingType;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADDITIONAL_USERS)
  additionalUsers?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  couponCode?: string;

  /**
   * O total que a tela mostrou. Se o preço mudou entre o orçamento e o
   * clique, a contratação é recusada com o orçamento novo, em vez de cobrar
   * um valor que a pessoa não viu.
   */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTotalCents?: number;

  @ApiProperty({ type: () => CheckoutContractorDto })
  @ValidateNested()
  @Type(() => CheckoutContractorDto)
  contractor: CheckoutContractorDto;

  @ApiProperty({ type: () => CheckoutRepresentativeDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutRepresentativeDto)
  representative?: CheckoutRepresentativeDto;

  @ApiProperty({
    required: false,
    description:
      'O Administrador Principal da Conta (Usuário nº 1) indicado pela contratante, entre os administradores ativos da empresa. Sem ele, fica o atual.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  principalAdminUserId?: string;

  @ApiProperty({ type: () => CheckoutTermsDto })
  @ValidateNested()
  @Type(() => CheckoutTermsDto)
  termsAcceptance: CheckoutTermsDto;
}

/**
 * Evolução para o próximo plano da trilha. O contratante é o da assinatura em
 * curso, exibido em leitura — por isso não vem no pedido: a troca de titular
 * é assunto da transferência de titularidade.
 */
export class EvolutionDto {
  @ApiProperty()
  @IsString()
  planId: string;

  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], required: false })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  cycle?: 'MONTHLY' | 'YEARLY';

  @ApiProperty({
    required: false,
    description: 'Parcelas do anual no cartão (1 a 12); 1 é à vista',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CARD_MAX_INSTALLMENTS)
  installmentCount?: number;

  @ApiProperty({ enum: CHECKOUT_BILLING_TYPES })
  @IsIn(CHECKOUT_BILLING_TYPES)
  billingType: CheckoutBillingType;

  @ApiProperty({
    required: false,
    type: [String],
    description: 'Todos os módulos do plano novo, os atuais inclusive',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADDITIONAL_USERS)
  additionalUsers?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedTotalCents?: number;

  @ApiProperty({ type: () => CheckoutTermsDto })
  @ValidateNested()
  @Type(() => CheckoutTermsDto)
  termsAcceptance: CheckoutTermsDto;
}

/** Complementos a incluir na assinatura em curso. */
export class ComplementsQuoteDto {
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Chaves dos módulos a incluir (os já contratados ficam)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiProperty({
    required: false,
    description: 'Quantos usuários adicionais a assinatura passa a ter',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ADDITIONAL_USERS)
  additionalUsers?: number;
}

export class ComplementsDto extends ComplementsQuoteDto {
  /** A renovação que a tela mostrou; mudou no caminho, o pedido é recusado. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRecurringCents?: number;

  @ApiProperty({ type: () => CheckoutTermsDto })
  @ValidateNested()
  @Type(() => CheckoutTermsDto)
  termsAcceptance: CheckoutTermsDto;
}

export class RepresentativeCheckDto {
  @ApiProperty()
  @IsCnpj({ message: 'CNPJ inválido.' })
  cnpj: string;

  @ApiProperty()
  @IsCpf({ message: 'CPF inválido.' })
  cpf: string;
}

export class RegularizationDto {
  @ApiProperty({ enum: CHECKOUT_BILLING_TYPES })
  @IsIn(CHECKOUT_BILLING_TYPES)
  billingType: CheckoutBillingType;

  @ApiProperty({ type: () => CheckoutTermsDto })
  @ValidateNested()
  @Type(() => CheckoutTermsDto)
  termsAcceptance: CheckoutTermsDto;
}

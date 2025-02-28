import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsArray,
  IsNumber,
  IsUUID,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BiilingKind,
  CommissionType,
  InvoiceType,
  transferMethodCommission,
} from '@prisma/client';

export class UpdateCommissionDto {
  @ApiProperty({
    description: 'Tipo de operação da comissão',
    enum: ['ADD', 'SUB'],
    example: 'ADD',
  })
  @IsEnum(CommissionType)
  type: CommissionType;

  @ApiProperty({
    description: 'ID do fornecedor associado à comissão',
    example: 'uuid',
  })
  @IsString({ message: 'O supplierId deve ser uma string' })
  @IsNotEmpty({ message: 'O supplierId é obrigatório' })
  supplierId: string;

  @ApiProperty({
    description: 'Método de transferência para a comissão',
    enum: ['SINGLE', 'PAYMENT_BASED'],
    example: 'SINGLE',
  })
  @IsEnum(transferMethodCommission)
  transferMethod: transferMethodCommission;

  @ApiProperty({
    description: 'Tipo de comissão',
    enum: ['PERCENT', 'VALUE'],
    example: 'PERCENT',
  })
  @IsEnum(['PERCENT', 'VALUE'], {
    message: 'O tipo de comissão deve ser PERCENT ou VALUE',
  })
  commissionType: string;

  @ApiProperty({
    description: 'Valor da comissão',
    example: 10,
  })
  @IsNumber({}, { message: 'O valor da comissão deve ser um número' })
  @IsNotEmpty({ message: 'O valor da comissão é obrigatório' })
  commissionValue: number;

  @ApiProperty({
    description: 'Valor total da comissão',
    example: 10,
  })
  @IsNumber({}, { message: 'O valor total da comissão deve ser um número' })
  @IsNotEmpty({ message: 'O valor total da comissão é obrigatório' })
  totalCommission: number;
}

export class InstallmentDto {
  @ApiProperty()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: 'Data de vencimento da parcela' })
  @IsString()
  @IsNotEmpty()
  dueDate: string;

  @ApiProperty({ description: 'Taxa de acréscimo na parcela' })
  @IsNumber()
  @IsOptional()
  additionalFee?: number;

  @ApiProperty({ description: 'Valor da parcela' })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}

export class DownPaymentDto {
  @ApiProperty({ description: 'ID da condição de pagamento' })
  @IsUUID()
  @IsOptional()
  paymentConditionId?: string;

  @ApiProperty({ description: 'Taxa de acréscimo' })
  @IsNumber()
  @IsOptional()
  additionalFee?: number;

  @ApiProperty({ description: 'Valor da entrada' })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({ description: 'Data de vencimento da entrada' })
  @IsString()
  @IsOptional()
  dueDate?: string;
}

export class DiscountDto {
  @ApiProperty({ description: 'Tipo de desconto', enum: ['VALUE', 'PERCENT'] })
  @IsString()
  @IsNotEmpty()
  discountType: string;

  @ApiProperty({ description: 'Valor do desconto' })
  @IsNumber()
  @IsNotEmpty()
  discountValue: number;

  @ApiProperty({ description: 'Valor total do desconto' })
  @IsNumber()
  @IsOptional()
  discountTotal?: number;
}

export class UpdatePaymentDto {
  @ApiProperty({ description: 'Tipo de fatura', enum: ['NFE', 'OTHER'] })
  @IsEnum(InvoiceType)
  @IsNotEmpty()
  type: InvoiceType;

  @ApiProperty({
    description: 'Forma de faturamento',
    enum: ['ON_ORDER', 'AFTER_ORDER'],
  })
  @IsEnum(BiilingKind)
  @IsNotEmpty()
  billing: BiilingKind;

  @ApiProperty({ description: 'ID do método de pagamento' })
  @IsUUID()
  @IsOptional()
  paymentMethodId?: string;

  @ApiProperty({ description: 'ID da condição de pagamento' })
  @IsUUID()
  @IsOptional()
  paymentConditionId?: string;

  @ApiProperty({ description: 'Quantidade de parcelas' })
  @IsNumber()
  @IsOptional()
  installmentQty?: number;

  @ApiProperty({ description: 'Indica se tem entrada' })
  @IsBoolean()
  @IsOptional()
  hasDownPayment?: boolean;

  @ApiProperty({ description: 'Informações da comissão' })
  @ValidateNested()
  @Type(() => UpdateCommissionDto)
  @IsOptional()
  commission?: UpdateCommissionDto;

  @ApiProperty({ description: 'Informações do desconto' })
  @ValidateNested()
  @Type(() => DiscountDto)
  @IsOptional()
  discount?: DiscountDto;

  @ApiProperty({ description: 'Valor total' })
  @IsNumber()
  @IsNotEmpty()
  totalValue: number;

  @ApiProperty({ description: 'Informações da entrada' })
  @ValidateNested()
  @Type(() => DownPaymentDto)
  @IsOptional()
  downPayment?: DownPaymentDto;

  @ApiProperty({ description: 'Lista de parcelas' })
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  @IsArray()
  installments: InstallmentDto[];

  @ApiProperty({ description: 'Descrição' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Valor final' })
  @IsNumber()
  @IsOptional()
  finalValue?: number;

  @ApiProperty({ description: 'Quantidade mínima de parcelas' })
  @IsNumber()
  @IsOptional()
  minInstallmentQty?: number;

  @ApiProperty({ description: 'Quantidade máxima de parcelas' })
  @IsNumber()
  @IsOptional()
  maxInstallmentQty?: number;

  @ApiProperty({ description: 'Taxa de acréscimo principal' })
  @IsNumber()
  @IsOptional()
  mainAdditionalFee?: number;

  @ApiProperty({
    description: 'Tipo de taxa de acréscimo',
    enum: ['VALUE', 'PERCENT'],
  })
  @IsString()
  @IsOptional()
  additionalFeeType?: string;
}

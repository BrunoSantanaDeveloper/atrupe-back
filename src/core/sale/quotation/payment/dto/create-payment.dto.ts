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
}
class InstallmentDto {
  @ApiProperty()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: 'Data de vencimento da parcela' })
  @IsString()
  @IsOptional()
  dueDate: string;

  @ApiProperty({ description: 'Método de pagamento para a parcela' })
  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @ApiProperty({ description: 'Taxa de acréscimo na parcela' })
  @IsNumber()
  @IsOptional()
  additionalFee?: number;

  @ApiProperty({ description: 'Valor da parcela' })
  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class DownPaymentDto {
  @ApiProperty({ description: 'Data de vencimento da parcela' })
  @IsString()
  @IsOptional()
  dueDate?: string;

  @ApiProperty({ description: 'Método de pagamento para a parcela' })
  @IsOptional()
  @IsString()
  paymentConditionId?: string;

  @ApiProperty({ description: 'Taxa de acréscimo na parcela' })
  @IsNumber()
  @IsOptional()
  additionalFee?: number;

  @ApiProperty({ description: 'Valor da parcela' })
  @IsNumber()
  @IsOptional()
  amount?: number;
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

  @ApiProperty({ description: 'Desconto aplicado', default: 0 })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiProperty({ description: 'Tipo de desconto', enum: ['VALUE', 'PERCENT'] })
  @IsString()
  @IsOptional()
  discountType?: string;

  @ApiProperty({ description: 'Descrição', example: 'teste' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'ID do metodo de pagamento', required: false })
  @IsUUID()
  @IsOptional()
  paymentMethodId?: string;

  @ApiProperty({ description: 'ID da condição de pagamento', required: false })
  @IsUUID()
  @IsOptional()
  paymentConditionId?: string;

  @ApiProperty({ description: 'Valor total do orçamento', default: 0 })
  @IsNumber()
  @IsNotEmpty()
  totalValue: number;

  @ApiProperty({ description: 'Valor final calculado', default: 0 })
  @IsNumber()
  @IsOptional()
  finalValue?: number;

  @ApiProperty({
    description: 'Comissão do orçamento',
    type: UpdateCommissionDto,
  })
  @Type(() => UpdateCommissionDto)
  @IsOptional()
  commission: UpdateCommissionDto;

  @ApiProperty({
    description: 'Entrada do orçamento',
    type: DownPaymentDto,
  })
  @Type(() => DownPaymentDto)
  @IsOptional()
  downPayment: DownPaymentDto;

  @ApiProperty({
    description: 'Parcelas pagas do orçamento',
    type: [InstallmentDto],
  })
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  @IsArray()
  installments: InstallmentDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsOptional,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
export class CreatePayableInstallmentDto {
  @ApiProperty({
    description: 'Data de vencimento da parcela',
    example: '2024-12-15',
  })
  @IsDateString()
  dueDate: string;

  @ApiProperty({
    description: 'Valor da parcela',
    example: 150.75,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'ID da forma de pagamento específica da parcela',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  paymentMethodId: string;

  @ApiPropertyOptional({
    description: 'Acréscimos na parcela (opcional)',
    example: 10.5,
  })
  @IsOptional()
  @IsNumber()
  additionalFee?: number;

  @ApiPropertyOptional({
    description: 'Status da parcela (PENDING, PAID, CANCELED)',
    example: 'PENDING',
    enum: ['PENDING', 'PAID', 'CANCELED'],
  })
  @IsOptional()
  @IsString()
  status?: 'PENDING' | 'PAID' | 'CANCELED';

  @ApiPropertyOptional({
    description: 'Data de pagamento da parcela (se pago)',
    example: '2024-12-20',
  })
  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
export class CreatePayableDto {
  @ApiProperty({
    description: 'Referência da conta a receber (exemplo: número da fatura)',
    example: 'INV-2024-001',
  })
  @IsString()
  @IsNotEmpty()
  reference: string;

  @ApiProperty({
    description: 'Data de referência da conta a receber',
    example: '2024-11-27',
  })
  @IsDateString()
  referenceDate: string;

  @ApiProperty({
    description: 'Data de vencimento da conta a receber',
    example: '2024-12-15',
  })
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({
    description: 'Descrição adicional da conta a receber',
    example: 'Pagamento referente à prestação de serviços de novembro.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Observações adicionais',
    example: 'Cliente solicitou envio da nota fiscal por e-mail.',
  })
  @IsOptional()
  @IsString()
  observations?: string;

  @ApiPropertyOptional({
    description: 'Natureza da conta (exemplo: receita recorrente)',
    example: 'Receita recorrente',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  natureId?: string;

  @ApiProperty({
    description: 'ID do fornecedor associado à conta',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @IsString()
  @IsUUID()
  supplierId: string;

  @ApiProperty({
    description: 'ID da conta bancária onde será realizado o pagamento',
    example: '7b3d32c3-2d4c-4efb-9149-7345c2e68810',
  })
  @IsString()
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({
    description: 'ID da forma de pagamento padrão',
    example: '68b92507-1c6e-48a3-927c-91ef2b567c3d',
  })
  @IsString()
  @IsUUID()
  paymentMethodId: string;

  @ApiProperty({
    description: 'ID da categoria associada à conta',
    example: 'f5b934f6-4c45-4e93-85f4-6e418af93210',
  })
  @IsString()
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    description: 'ID da subcategoria associada (opcional)',
    example: 'e3b9d6a5-4c1e-41e7-bb74-74f2dcf2f5bc',
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  subCategoryId?: string;

  // @ApiProperty({
  //   description: 'ID da empresa associada à conta',
  //   example: '75c934d6-0c45-4e93-95f4-6e418af93210',
  // })
  // @IsString()
  // @IsUUID()
  companyId: string;

  totalAmount: number;

  @ApiProperty({
    description: 'Quantidade de parcelas',
    example: 3,
  })
  @IsNumber()
  installmentQty: number;

  @ApiProperty({
    description: 'Array com as parcelas associadas à conta',
    type: [CreatePayableInstallmentDto],
  })
  @IsArray()
  @Type(() => CreatePayableInstallmentDto)
  installments: CreatePayableInstallmentDto[];
}

export class PayableInstallmentDto {
  @ApiProperty({
    description: 'ID da parcela (se existir, significa que é para atualizar)',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  id?: string;

  @ApiProperty({
    description: 'Valor da parcela',
    example: 200.75,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({
    description: 'Data de vencimento',
    example: '2024-12-25',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiProperty({
    description: 'ID da forma de pagamento',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  paymentMethodId?: string;
}

export class UpdatePayableInstallmentsDto {
  @ApiProperty({
    description:
      'Lista de parcelas que serão adicionadas, editadas ou removidas',
    type: [PayableInstallmentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayableInstallmentDto)
  installments: PayableInstallmentDto[];
}

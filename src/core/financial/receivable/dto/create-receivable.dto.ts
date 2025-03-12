import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator';
export class CreateReceivableInstallmentDto {
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
    description: 'Status da parcela (PENDING, PAID, OVERDUE,CANCELED)',
    example: 'PENDING',
    enum: ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'],
  })
  @IsOptional()
  @IsString()
  status?: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';

  @ApiPropertyOptional({
    description: 'Data de pagamento da parcela (se pago)',
    example: '2024-12-20',
  })
  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
export class CreateReceivableDto {
  reference?: string;

  @ApiProperty({
    description: 'Data de referência da conta a receber',
    example: '2024-11-27',
  })
  @IsDateString()
  referenceDate?: string;

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
  notes?: string;

  @ApiProperty({
    description: 'ID do cliente associado à conta',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @IsString()
  @IsUUID()
  clientId: string;

  @IsOptional()
  @ApiProperty({
    description: 'ID da natureza associado à conta',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @IsString()
  @IsUUID()
  natureId?: string;

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
    type: [CreateReceivableInstallmentDto],
  })
  @IsArray()
  @Type(() => CreateReceivableInstallmentDto)
  installments: CreateReceivableInstallmentDto[];
}

export class ReceivableInstallmentDto {
  @ApiProperty({
    description: 'ID da parcela (se existir, significa que é para atualizar)',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  id?: string;

  @ApiProperty({
    description: 'ID original (descartar)',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
    required: false,
  })
  @IsOptional()
  originalId?: string;

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

export class UpdateReceivableInstallmentsDto {
  @ApiProperty({
    description: 'Valor da movimentação',
    example: 200.75,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiProperty({
    description: 'Motivo de alteração',
    example: 'Altrado o valor',
    required: false,
  })
  @IsOptional()
  changeReason?: string;

  @ApiProperty({
    description: 'Motivo de alteração',
    example: 'Altrado o valor',
    required: false,
  })
  @IsOptional()
  changeNotes?: string;

  @ApiProperty({
    description:
      'Lista de parcelas que serão adicionadas, editadas ou removidas',
    type: [ReceivableInstallmentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivableInstallmentDto)
  installments: ReceivableInstallmentDto[];
}

export class CompensateDto {
  @ApiProperty()
  @IsDateString()
  paidDate: string;
}

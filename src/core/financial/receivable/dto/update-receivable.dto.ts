import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
} from 'class-validator';

export class UpdateReceivableDto {
  @ApiPropertyOptional({
    description: 'ID do cliente associado',
    example: 'b1d5f894-4c4d-4b7c-828c-2fbd9f5f7bcb',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description: 'Natureza do título',
    example: 'Receita recorrente',
  })
  @IsOptional()
  @IsString()
  nature?: string;

  @ApiPropertyOptional({
    description: 'Descrição adicional',
    example: 'Pagamento de prestação de serviços',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'ID da categoria',
    example: 'f5b934f6-4c45-4e93-85f4-6e418af93210',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'ID da subcategoria',
    example: 'e3b9d6a5-4c1e-41e7-bb74-74f2dcf2f5bc',
  })
  @IsOptional()
  @IsUUID()
  subCategoryId?: string;

  @ApiPropertyOptional({
    description: 'Observações adicionais',
    example: 'Enviar comprovante ao cliente.',
  })
  @IsOptional()
  @IsString()
  observations?: string;

  @ApiPropertyOptional({
    description: 'Valor total do título',
    example: 1500.75,
  })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;
}

export class UpdateReceivableInstallmentDto {
  @ApiProperty({ description: 'Valor da parcela', example: 500.25 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({
    description: 'Data de vencimento da parcela',
    example: '2024-12-15',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({
    description: 'ID da forma de pagamento',
    example: '68b92507-1c6e-48a3-927c-91ef2b567c3d',
  })
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;
}

export class AddReceivableInstallmentDto {
  @ApiProperty({ description: 'Valor da parcela', example: 200.75 })
  @IsNumber()
  amount: number;

  @ApiProperty({ description: 'Data de vencimento', example: '2024-12-25' })
  @IsDateString()
  dueDate: string;

  @ApiProperty({
    description: 'ID da forma de pagamento',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  paymentMethodId: string;

  @ApiProperty({ description: 'Acréscimo (opcional)', example: 10.0 })
  @IsNumber()
  @IsOptional()
  additionalFee?: number;
}

export class AddInstallmentArrayDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddReceivableInstallmentDto)
  @ApiProperty({
    description: 'Novas parcelas para adicionar',
    type: [AddReceivableInstallmentDto],
  })
  installments: AddReceivableInstallmentDto[];
}

export class CancelReceivableDto {
  @ApiProperty({
    description: 'Razão do cancelamento do título',
    example: 'Cliente desistiu da compra.',
  })
  @IsString()
  cancelReason: string; // Razão do cancelamento
}

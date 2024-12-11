import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  IsDateString,
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
    required: false,
  })
  @IsOptional()
  @IsUUID()
  natureId?: string;

  @ApiPropertyOptional({
    description: 'Descrição adicional',
    example: 'Pagamento de prestação de serviços',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'ID da subcategoria',
    example: 'e3b9d6a5-4c1e-41e7-bb74-74f2dcf2f5bc',
    required: false,
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
  notes?: string;

  @ApiPropertyOptional({
    description: 'Valor total do título',
    example: 1500.75,
  })
  @IsOptional()
  @IsNumber()
  totalAmount?: number;
}

export class CancelReceivableDto {
  @IsOptional()
  @ApiProperty({
    description: 'Razão do cancelamento do título',
    example: 'Cliente desistiu da compra.',
  })
  @IsString()
  cancelReason?: string; // Razão do cancelamento

  @IsOptional()
  @ApiProperty({
    description: 'Razão do cancelamento do título',
    example: 'Cliente desistiu da compra.',
  })
  @IsString()
  cancelNotes?: string; // Razão do cancelamento
}

export class PayInstallmentDto {
  @ApiProperty({
    description: 'ID da parcela que será paga',
    example: 'd5b0e414-6c7c-4b7a-88f3-5a3e216e1e2f',
  })
  @IsUUID()
  installmentId: string;

  @ApiProperty({
    description: 'Valor pago na parcela',
    example: 200.75,
  })
  @IsNumber()
  amount: number;

  @ApiProperty({
    description: 'Data do pagamento',
    example: '2024-12-25',
  })
  @IsDateString()
  paidDate: string;
}

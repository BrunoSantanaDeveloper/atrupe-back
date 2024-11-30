import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsUUID,
  IsPositive,
} from 'class-validator';

export class CreateQuotationPaymentDto {
  @ApiProperty({ description: 'ID do orçamento relacionado' })
  @IsUUID()
  quotationId: string;

  @ApiPropertyOptional({ description: 'Configuração de faturamento' })
  @IsString()
  @IsOptional()
  billing?: string;

  @ApiPropertyOptional({ description: 'Desconto aplicado', default: 0 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  discount: number = 0;

  @ApiPropertyOptional({ description: 'Valor de entrada', default: 0 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  downPayment: number = 0;

  @ApiPropertyOptional({ description: 'ID da forma de pagamento' })
  @IsUUID()
  @IsOptional()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'ID da condição de pagamento' })
  @IsUUID()
  @IsOptional()
  paymentConditionId?: string;

  @ApiPropertyOptional({ description: 'ID da comissão' })
  @IsUUID()
  @IsOptional()
  commissionId?: string;

  @ApiProperty({ description: 'Valor total do orçamento' })
  @IsNumber()
  @IsPositive()
  totalValue: number;

  @ApiPropertyOptional({ description: 'Descrição/observações' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Valor final (ajustado)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  finalValue?: number;
}

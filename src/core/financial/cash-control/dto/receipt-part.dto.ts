import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/** Uma parte do recebimento (FC-9), em centavos. */
export class ReceiptPartDto {
  @ApiProperty({ enum: ['CASH', 'PIX', 'CARD'] })
  @IsIn(['CASH', 'PIX', 'CARD'])
  method: 'CASH' | 'PIX' | 'CARD';

  @ApiProperty({ description: 'A forma de pagamento do cadastro' })
  @IsUUID()
  paymentConditionId: string;

  @ApiPropertyOptional({
    description: 'A conta escolhida; sem ela, a conta padrão da forma',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @ApiProperty({
    description: 'Em centavos; o troco já sai da parte em dinheiro',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Cada parte do pagamento precisa de valor' })
  amount: number;
}

/** As partes e o arredondamento no balcão (FC-18), em centavos. */
export class ReceiptDto {
  @ApiProperty({ type: [ReceiptPartDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Informe o pagamento' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptPartDto)
  parts: ReceiptPartDto[];

  @ApiPropertyOptional({ description: 'Arredondamento no balcão, em centavos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({
    description: 'O troco dado, em centavos (fica no comprovante, FC-16)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  change?: number;
}

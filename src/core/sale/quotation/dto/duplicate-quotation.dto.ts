import { IsEnum, IsNotEmpty } from 'class-validator';
import { DuplicateQuotationPrice } from '../entities/quotation.entity';
import { ApiProperty } from '@nestjs/swagger';

export class DuplicateQuotationDto {
  @IsNotEmpty()
  @IsEnum(DuplicateQuotationPrice)
  @ApiProperty({
    description: 'Tipo de preço para duplicação do orçamento',
    example: DuplicateQuotationPrice.KEEP,
    enum: DuplicateQuotationPrice,
  })
  price: DuplicateQuotationPrice;
}

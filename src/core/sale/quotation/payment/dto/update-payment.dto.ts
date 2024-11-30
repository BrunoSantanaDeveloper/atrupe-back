import { PartialType } from '@nestjs/swagger';
import { CreateQuotationPaymentDto } from './create-payment.dto';

export class UpdateQuotationPaymentDto extends PartialType(
  CreateQuotationPaymentDto,
) {}

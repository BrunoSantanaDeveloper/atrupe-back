import { PartialType } from '@nestjs/swagger';
import { CreateInvoicyConfigDto } from './create-invoicy-config.dto';

export class UpdateInvoicyConfigDto extends PartialType(CreateInvoicyConfigDto) {}

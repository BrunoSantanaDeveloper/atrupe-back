import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateClientDto } from '../../client/dto/update-client.dto';
import { SupplierPaymentDto } from './create-supplier.dto';

export class UpdateSupplierDto extends PartialType(UpdateClientDto) {
  // Dados de pagamento do fornecedor (26/10/2026)
  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierPaymentDto)
  payment?: SupplierPaymentDto;
}

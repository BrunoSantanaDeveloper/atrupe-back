import { ApiProperty } from '@nestjsx/crud/lib/crud';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { InstallmentListFilterDto } from '../../utils/installment-list-filter';

export class ReceivableFilterDto extends InstallmentListFilterDto {
  @IsOptional()
  @IsDateString()
  dueDate?: Date;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Busca por nome do clienete, fornecedor ou contato',
    example: 'John Doe',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  paymentConditionId?: string;
}

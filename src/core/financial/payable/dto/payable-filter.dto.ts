import { ApiProperty } from '@nestjsx/crud/lib/crud';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { InstallmentListFilterDto } from '../../utils/installment-list-filter';

export class PayableFilterDto extends InstallmentListFilterDto {
  @IsOptional()
  @IsDateString()
  dueDate?: Date;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Busca por nome do fornecedor, funcionário ou subcategoria',
    example: 'João Silva',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Filtrar por fornecedor',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Filtrar por funcionário',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  employeeId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  paymentConditionId?: string;
}

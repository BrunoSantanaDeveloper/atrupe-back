import { IsDate, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class FinancialFlowFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  @ApiProperty({
    description: 'Data de início para filtrar os fluxos financeiros',
    example: '2023-01-01',
    required: false,
    type: 'string',
    format: 'date',
  })
  startDate?: Date;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : undefined))
  @IsDate()
  @ApiProperty({
    description: 'Data de término para filtrar os fluxos financeiros',
    example: '2023-12-31',
    required: false,
    type: 'string',
    format: 'date',
  })
  endDate?: Date;

  // @IsOptional()
  // @IsUUID()
  // @ApiProperty({
  //   description: 'ID da conta bancária para filtrar os fluxos financeiros',
  //   example: '123e4567-e89b-12d3-a456-426614174000',
  //   required: false,
  // })
  // bankAccountId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description:
      'ID da condição de pagamento para filtrar os fluxos financeiros',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  paymentConditionId?: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID da conta de banco para filtrar os fluxos financeiros',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Status do fluxo financeiro para filtrar os resultados',
    example: 'PAID',
    required: false,
  })
  status?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Busca de resultados',
    example: 'Teste',
    required: false,
  })
  search?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Ordena os resultados("desc" ou "asc")',
    example: 'desc',
    required: false,
  })
  sort?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Mostrar valores("on" ou "off")',
    example: 'on',
    required: false,
  })
  showValues?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Filtrar por datas("dueDate" ou "paidDate)',
    example: 'dueDate',
    required: false,
  })
  dateType?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID do cliente  para filtrar os fluxos financeiros',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  clientId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'ID do cliente  para filtrar os fluxos financeiros',
    example: '123e4567-e89b-12d3-a456-426614174001',
    required: false,
  })
  supplierId?: string;
}

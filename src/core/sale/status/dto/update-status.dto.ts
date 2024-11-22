import { PartialType } from '@nestjs/mapped-types';
import { CreateStatusQuotationDto } from './create-status.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class UpdateStatusQuotationDto extends PartialType(
  CreateStatusQuotationDto,
) {
  @ApiProperty({
    description: 'Indica se o status de orçamento está ativo',
    required: false,
    default: true,
  })
  @IsOptional()
  isActive?: boolean;
}

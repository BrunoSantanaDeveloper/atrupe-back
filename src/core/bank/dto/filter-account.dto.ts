import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';
import { ApiProperty } from '@nestjs/swagger';

export class BankAccountFilterDTO extends BaseFilterDTO {
  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'ID do banco associado',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  bankId: string;

  @IsOptional()
  @IsBooleanString()
  @ApiProperty({
    description: 'Indica se a conta aceita rendimentos',
    example: 'true',
    required: false,
  })
  acceptIncomes: boolean;

  @IsOptional()
  @IsBooleanString()
  @ApiProperty({
    description: 'Indica se a conta aceita pagamentos',
    example: 'false',
    required: false,
  })
  acceptPayments: boolean;
}

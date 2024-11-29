import { IsOptional, IsString, IsEnum } from 'class-validator';
import { CashRegisterStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { BaseFilterDTO } from 'src/shared/dto/filter.dto';

export class ListCashRegistersDto extends BaseFilterDTO {
  @ApiProperty({ description: 'Nome da conta bancária', required: false })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiProperty({ description: 'Banco associado', required: false })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiProperty({
    description: 'Tipo da transação',
    enum: CashRegisterStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(CashRegisterStatus)
  status?: CashRegisterStatus;
}

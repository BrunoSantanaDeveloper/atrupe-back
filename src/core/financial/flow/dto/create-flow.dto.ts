import { FinancialFlowType } from '@prisma/client';
import {
  IsDate,
  IsDecimal,
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFlowDto {
  @IsNotEmpty()
  @IsDecimal()
  @ApiProperty({
    description: 'Valor do fluxo financeiro',
    example: 1000.0,
  })
  amount: number;

  @IsNotEmpty()
  @IsEnum(FinancialFlowType)
  @ApiProperty({
    description: 'Tipo do fluxo financeiro',
    example: FinancialFlowType.INCOME,
    enum: FinancialFlowType,
  })
  type: FinancialFlowType;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Descrição do fluxo financeiro',
    example: 'Pagamento de fatura',
  })
  description: string;

  @IsNotEmpty()
  @IsDate()
  @ApiProperty({
    description: 'Data do fluxo financeiro',
    example: '2023-06-01T00:00:00.000Z',
    type: 'string', // Swagger espera uma string para datas
    format: 'date-time',
  })
  date: Date;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao fluxo financeiro',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}

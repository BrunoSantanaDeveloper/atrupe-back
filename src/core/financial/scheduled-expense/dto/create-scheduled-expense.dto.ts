import {
  IsDate,
  IsDecimal,
  IsNotEmpty,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateScheduledExpenseDto {
  @IsNotEmpty()
  @IsDecimal()
  @ApiProperty({
    description: 'Valor da despesa agendada',
    example: 500.0,
  })
  amount: number;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Descrição da despesa agendada',
    example: 'Pagamento de fornecedor',
  })
  description: string;

  @IsNotEmpty()
  @IsDate()
  @ApiProperty({
    description: 'Data de vencimento da despesa agendada',
    example: '2023-07-01T00:00:00.000Z',
    type: 'string', // Swagger espera uma string para datas
    format: 'date-time',
  })
  dueDate: Date;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à despesa agendada',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}

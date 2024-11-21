import { IsDate, IsDecimal, IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCashControlDto {
  @IsNotEmpty()
  @IsDecimal()
  @ApiProperty({
    description: 'Saldo de abertura do caixa',
    example: 1000.0,
  })
  opening: number;

  @IsNotEmpty()
  @IsDecimal()
  @ApiProperty({
    description: 'Saldo de fechamento do caixa',
    example: 1500.0,
  })
  closing: number;

  @IsNotEmpty()
  @IsDate()
  @ApiProperty({
    description: 'Data do controle de caixa',
    example: '2023-06-01T00:00:00.000Z',
    type: 'string', // Swagger espera uma string para datas
    format: 'date-time',
  })
  date: Date;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada ao controle de caixa',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}

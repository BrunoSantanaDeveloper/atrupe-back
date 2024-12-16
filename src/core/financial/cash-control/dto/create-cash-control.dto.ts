import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCashRegisterDto {
  @ApiProperty({
    description: 'Data de abertura do caixa (padrão: hoje)',
    example: '2024-11-29',
  })
  @IsOptional()
  @IsString()
  openingDate?: string;

  // @ApiProperty({ description: 'Saldo inicial do caixa', example: 1000.0 })
  // @IsNotEmpty()
  // @IsNumber()
  // openingBalance: number;

  @ApiProperty({
    description: 'ID da conta bancária associada',
    example: 'b305cdc3-3fef-4f49-95d8-0bc48b02c00c',
  })
  @IsNotEmpty()
  @IsUUID()
  bankAccountId: string;
  companyId: string;
}

export class CloseCashRegisterDto {
  cashRegisterId: string;

  @ApiProperty({
    description: 'Observações do fechamento do caixa',
    example: 'Caixa fechado com sucesso',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

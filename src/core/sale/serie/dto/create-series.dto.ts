import { IsNotEmpty, IsNumber, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSeriesDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome da série de vendas',
    example: 'Série 2023',
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Código da série de vendas',
    example: 'SER2023',
  })
  code: string;

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({
    description: 'Duração da cotação em dias',
    example: 30,
  })
  quotationDuration: number;

  @IsNotEmpty()
  @IsNumber()
  @ApiProperty({
    description: 'Duração da entrega em dias',
    example: 7,
  })
  deliveryDuration: number;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'ID da empresa associada à série de vendas',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  companyId: string;
}

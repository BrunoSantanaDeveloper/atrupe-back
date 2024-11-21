import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBankDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do banco',
    example: 'Banco de Exemplo',
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Código do banco',
    example: '123',
  })
  code: string;
}

import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMethodDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do método de pagamento',
    example: 'Cartão de Crédito',
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Código do método de pagamento',
    example: 'CRD',
  })
  code: string;
}

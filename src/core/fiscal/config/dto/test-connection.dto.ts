import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TestConnectionDto {
  @ApiProperty({
    description: 'CNPJ da empresa',
    example: '00000000000000',
  })
  @IsString()
  @IsNotEmpty()
  cnpj: string;

  @ApiProperty({
    description: 'Chave de Parceiro Invoicy',
    example: 'EIqPbfmvrfy88W+PHslzMA==',
  })
  @IsString()
  @IsNotEmpty()
  partnerKey: string;

  @ApiProperty({
    description: 'Chave de Acesso Invoicy',
    example: 'FT5LiauxnDHZ8nsqE+Ce00i1+xxb0hMv',
  })
  @IsString()
  @IsNotEmpty()
  accessKey: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber } from 'class-validator';

export class AcceptContractDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID do contrato',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  contractId: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'IP do cliente',
    example: '192.168.1.1',
    required: true,
  })
  ipAddress: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'User agent do cliente',
    example:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    required: true,
  })
  userAgent: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'ID do usuário',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: true,
  })
  userId: string;
}

export class CreateContractDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Título do contrato',
    example: 'Contrato de assinatura',
    required: true,
  })
  title: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Conteúdo do contrato',
    example: 'Conteúdo do contrato',
    required: true,
  })
  content: string;

  @IsNumber()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Versão do contrato',
    example: 1,
    required: true,
  })
  version: number;
}

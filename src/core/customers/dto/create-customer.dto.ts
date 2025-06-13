import { IsString, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({
    description: 'Nome do cliente',
    example: 'João Silva',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Email do cliente',
    example: 'joao.silva@email.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Documento do cliente (CPF/CNPJ)',
    example: '123.456.789-00',
  })
  @IsString()
  document: string;

  @ApiPropertyOptional({
    description: 'Telefone do cliente',
    example: '(11) 99999-9999',
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Endereço do cliente',
    example: 'Rua das Flores',
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: 'Número do endereço',
    example: '123',
  })
  @IsString()
  @IsOptional()
  addressNumber?: string;

  @ApiPropertyOptional({
    description: 'Complemento do endereço',
    example: 'Apto 45',
  })
  @IsString()
  @IsOptional()
  complement?: string;

  @ApiPropertyOptional({
    description: 'Bairro',
    example: 'Centro',
  })
  @IsString()
  @IsOptional()
  province?: string;

  @ApiPropertyOptional({
    description: 'CEP',
    example: '12345-678',
  })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({
    description: 'Cidade',
    example: 'São Paulo',
  })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({
    description: 'Estado',
    example: 'SP',
  })
  @IsString()
  @IsOptional()
  state?: string;

  companyId?: string;

  userId?: string;
}

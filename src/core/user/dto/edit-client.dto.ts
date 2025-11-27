import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EditClientDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'ID do cliente/empresa a ser editado',
    example: 'uuid-do-cliente',
    required: true,
  })
  id: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'E-mail do cliente',
    example: 'cliente@empresa.com',
    required: true,
  })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Razão social da empresa',
    example: 'Empresa LTDA',
    required: true,
  })
  legalName: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'CNPJ/CPF da empresa',
    example: '12.345.678/0001-90',
    required: true,
  })
  document: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome fantasia da empresa',
    example: 'Empresa XYZ',
    required: true,
  })
  companyName: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do responsável',
    example: 'João Silva',
    required: true,
  })
  userName: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Telefone do responsável',
    example: '(11) 98765-4321',
    required: true,
  })
  phone: string;

  @IsString()
  @ApiProperty({
    description: 'ID do Estado',
    example: 'SP',
    required: false,
  })
  stateId?: string;

  @IsString()
  @ApiProperty({
    description: 'ID da Cidade',
    example: 'São Paulo',
    required: false,
  })
  cityId?: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Senha do administrador do sistema para autorizar a operação',
    example: 'senha123',
    required: true,
  })
  password: string;
}

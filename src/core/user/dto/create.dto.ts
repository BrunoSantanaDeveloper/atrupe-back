import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMailVerificationDto {
  @IsNotEmpty()
  @ApiProperty({
    description: 'Email do usuário',
    example: 'johndoe@example.com',
    required: true,
  })
  email: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do usuário',
    example: 'John Doe',
    required: false,
  })
  name?: string;

  @IsString()
  @ApiProperty({
    description: 'Nome da empresa',
    example: 'Empresa XYZ',
    required: false,
  })
  companyName?: string;

  @IsString()
  @ApiProperty({
    description: 'Telefone do usuário',
    example: '(11) 98765-4321',
    required: false,
  })
  phone?: string;
}

export class CreateUserDto {
  @IsNotEmpty()
  @ApiProperty({
    description: 'Email do usuário',
    example: 'johndoe@example.com',
    required: true,
  })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do usuário',
    example: 'John Doe',
    required: true,
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome fantasia do usuário',
    example: 'John Doe',
    required: true,
  })
  company: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Telefone do usuário',
    example: '1234567890',
    required: true,
  })
  mobile: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Senha do usuário',
    example: '123456',
    required: true,
  })
  password: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'CPF do responsável principal da conta (admin)',
    example: '123.456.789-00',
    required: false,
  })
  cpf?: string;
}

export class CreateUserByEmployeeDto {
  @IsString()
  @ApiProperty({
    description: 'ID do funcionário',
    example: '1234567890',
    required: true,
  })
  employeeId: string;

  @IsNotEmpty()
  @ApiProperty({
    description: 'Email do usuário',
    example: 'johndoe@example.com',
    required: true,
  })
  email: string;

  @IsString()
  @ApiProperty({
    description: 'Nome do usuário',
    example: 'John Doe',
    required: true,
  })
  name: string;

  company: string;

  @IsString()
  @ApiProperty({
    description: 'Senha do usuário',
    example: '123456',
    required: true,
  })
  password: string;
}

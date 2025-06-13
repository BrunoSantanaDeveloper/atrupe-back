import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMailVerificationDto {
  @IsNotEmpty()
  email: string;
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
}

export class CreateUserByEmployeeDto {
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

  @ApiProperty({
    description: 'ID do funcionário',
    example: '1234567890',
    required: true,
  })
  employeeId: string;
}

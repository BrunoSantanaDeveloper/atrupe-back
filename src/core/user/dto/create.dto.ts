import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @IsNotEmpty()
  @IsEmail()
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
  // @IsStrongPassword()
  @ApiProperty({
    description: 'Senha do usuário',
    example: 'StrongPassword123!',
    required: true,
  })
  password: string;

  @ApiProperty({
    description: 'ID do funcionário',
    example: '1234567890',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

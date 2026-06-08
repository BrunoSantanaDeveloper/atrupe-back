import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class AdminPasswordResetDto {
  @ApiProperty({
    description: 'Senha gerencial do administrador do sistema',
    example: 'senha123',
  })
  @IsString({ message: 'Senha invalida' })
  @IsNotEmpty({ message: 'Senha gerencial e obrigatoria' })
  @MinLength(6, { message: 'A senha deve ter pelo menos 6 caracteres' })
  password: string;
}

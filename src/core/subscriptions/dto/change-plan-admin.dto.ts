import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePlanAdminDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'ID do novo plano da empresa',
    example: 'uuid-do-plano',
    required: true,
  })
  planId: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @ApiProperty({
    description: 'Senha gerencial do administrador para autorizar a alteração',
    example: 'senha123',
    required: true,
  })
  password: string;
}

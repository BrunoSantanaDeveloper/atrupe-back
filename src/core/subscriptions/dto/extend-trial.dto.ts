import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtendTrialDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Senha do administrador do sistema para autorizar a operação',
    example: 'senha123',
    required: true,
  })
  password: string;
}

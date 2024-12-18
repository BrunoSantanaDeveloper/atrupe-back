import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSectorDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Nome do setor',
    example: 'Tecnologia',
    required: true,
  })
  name: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Ícone representativo do setor',
    example: 'tech-icon.png',
    required: true,
  })
  icon: string;

  companyId: string;
}

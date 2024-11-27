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

  // @IsNotEmpty()
  // @IsUUID()
  // @ApiProperty({
  //   description: 'ID da empresa associada ao setor',
  //   example: '123e4567-e89b-12d3-a456-426614174000',
  //   required: true,
  // })
  companyId: string;
}

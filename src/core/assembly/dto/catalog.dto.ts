import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class DuplicateProductDto {
  @IsString({ message: 'Informe o nome do produto' })
  @MaxLength(200)
  @ApiProperty({ example: 'Banner 440 com bastão (cópia)' })
  name: string;
}

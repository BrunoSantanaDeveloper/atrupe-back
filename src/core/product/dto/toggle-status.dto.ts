import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleStatusDto {
  @IsBoolean()
  @ApiProperty({
    description: 'Novo status ativo/inativo do produto',
    example: false,
  })
  isActive: boolean;
}

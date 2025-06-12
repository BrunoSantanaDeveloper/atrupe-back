import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean } from 'class-validator';

export class UpdateProgressDto {
  @ApiProperty({
    description: 'ID do item da academy',
    example: 'empresa-config',
  })
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'Status de conclusão', example: true })
  @IsBoolean()
  checked: boolean;
}

import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleMaterialDto {
  @IsBoolean()
  @ApiProperty()
  active: boolean;
}

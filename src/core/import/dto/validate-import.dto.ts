import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ValidateImportDto {
  @ApiProperty()
  @IsUUID()
  importId: string;
}

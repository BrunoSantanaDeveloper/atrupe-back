import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExecuteImportDto {
  @ApiProperty()
  @IsUUID()
  importId: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  useTransaction?: boolean;
}

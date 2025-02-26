import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateSectorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsBoolean()
  isProductionStage?: boolean;

  @ApiProperty({
    description: 'Indica se o setor está ativo',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

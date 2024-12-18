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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

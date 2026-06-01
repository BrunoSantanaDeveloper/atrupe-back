import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateAiModelConfigDto {
  @IsOptional()
  @IsString()
  activeModel?: string;

  @IsOptional()
  @IsBoolean()
  autoSelectionEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowlist?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blacklist?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  minContext?: number;
}

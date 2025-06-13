import { IsArray, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class UpdateAcademySystemDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  type?: string[];

  @IsString()
  @IsOptional()
  section?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  page?: string;

  @IsString()
  @IsOptional()
  modal?: string;

  @IsString()
  @IsOptional()
  buttonTitle?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  files?: string[];
}

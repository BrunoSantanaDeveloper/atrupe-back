import { IsArray, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateAcademySystemDto {
  @IsArray()
  @IsString({ each: true })
  type: string[];

  @IsString()
  section: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  order: number;

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

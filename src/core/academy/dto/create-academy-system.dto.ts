import {
  IsArray,
  IsOptional,
  IsString,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AcademyFileDto {
  @IsString()
  url: string;

  @IsString()
  name: string;
}

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
  @ValidateNested({ each: true })
  @Type(() => AcademyFileDto)
  @IsOptional()
  files?: AcademyFileDto[];
}

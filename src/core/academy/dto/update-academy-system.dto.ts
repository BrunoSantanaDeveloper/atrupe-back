import {
  IsArray,
  IsOptional,
  IsString,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AcademyFileDto } from './create-academy-system.dto';

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
  @ValidateNested({ each: true })
  @Type(() => AcademyFileDto)
  @IsOptional()
  files?: AcademyFileDto[];
}

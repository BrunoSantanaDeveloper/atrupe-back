import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateNatureDto {
  companyId: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  level1?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  level2?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  code?: number;
}

export class CreateSubCategoryDto {
  companyId: string;

  natureId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  code?: number;
}

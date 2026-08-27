import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ImportEntity {
  CLIENT = 'client',
  PRODUCT = 'product',
  QUOTATION = 'quotation',
  SUPPLIER = 'supplier',
  FINANCIAL = 'financial',
  ORDER = 'order',
  EMPLOYEE = 'employee',
}

export class UploadImportDto {
  @ApiProperty({ enum: ImportEntity })
  @IsEnum(ImportEntity)
  entity: ImportEntity;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  delimiter?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  encoding?: string;
}

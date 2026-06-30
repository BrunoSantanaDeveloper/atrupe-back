import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class ActivateEnvironmentDto {
  // environment comes from route param — not accepted in body

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  idempotencyKey?: string;

  @IsOptional()
  @IsBoolean()
  confirmFiscalValidity?: boolean;

  @IsOptional()
  @IsIn(['NFE', 'NFSE', 'NFCE'])
  docType?: 'NFE' | 'NFSE' | 'NFCE';
}

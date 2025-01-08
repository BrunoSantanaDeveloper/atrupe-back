import { Type } from 'class-transformer';
import {
  IsUUID,
  IsBoolean,
  IsOptional,
  IsNumber,
  ValidateNested,
  IsObject,
} from 'class-validator';

class UpdateCreditLimitConditionDto {
  @IsUUID()
  id: string;

  @IsBoolean()
  isActive: boolean;
}

// DTO para configurações de limite de crédito no Update (person ou company)
export class UpdateCreditLimitTypeDto {
  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsBoolean()
  applyMinValueToAll?: boolean;

  @IsOptional()
  @IsBoolean()
  applyMaxValueToAll?: boolean;

  @IsOptional()
  @IsBoolean()
  applyPaymentMethodsToAll?: boolean;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateCreditLimitConditionDto)
  conditions?: UpdateCreditLimitConditionDto[];
}

// DTO principal para Update
export class UpdateCreditLimitDefaultDto {
  companyId: string;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateCreditLimitTypeDto)
  person?: UpdateCreditLimitTypeDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateCreditLimitTypeDto)
  company?: UpdateCreditLimitTypeDto;
}

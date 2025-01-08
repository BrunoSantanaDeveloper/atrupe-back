import { Type } from 'class-transformer';
import {
  IsUUID,
  IsBoolean,
  IsNumber,
  ValidateNested,
  IsObject,
} from 'class-validator';

// DTO para condição de pagamento
class CreditLimitConditionDto {
  @IsUUID()
  id: string;

  @IsBoolean()
  isActive: boolean;
}

// DTO para configurações de limite de crédito de um tipo específico (person ou company)
export class CreditLimitTypeDto {
  @IsNumber()
  minValue: number;

  @IsNumber()
  maxValue: number;

  @IsBoolean()
  applyMinValueToAll: boolean;

  @IsBoolean()
  applyMaxValueToAll: boolean;

  @IsBoolean()
  applyPaymentMethodsToAll: boolean;

  @ValidateNested({ each: true })
  @Type(() => CreditLimitConditionDto)
  conditions: CreditLimitConditionDto[];
}

// DTO principal para criação e atualização
export class CreditLimitDefaultDto {
  companyId: string;
  @IsObject()
  @ValidateNested()
  @Type(() => CreditLimitTypeDto)
  person: CreditLimitTypeDto;

  @IsObject()
  @ValidateNested()
  @Type(() => CreditLimitTypeDto)
  company: CreditLimitTypeDto;
}

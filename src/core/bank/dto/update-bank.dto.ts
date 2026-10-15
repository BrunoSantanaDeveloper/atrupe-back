import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateBankDto } from './create-bank.dto';
import { CreateBankAccountDto } from './create-account.dto';

export class UpdateBankDto extends PartialType(CreateBankDto) {}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}

/** Reativar (padrão) ou inativar pela troca de situação. */
export class ToggleAccountDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

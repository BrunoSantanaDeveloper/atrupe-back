import { PartialType } from '@nestjs/mapped-types';
import { CreateBankDto } from './create-bank.dto';
import { CreateBankAccountDto } from './create-account.dto';

export class UpdateBankDto extends PartialType(CreateBankDto) {}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}

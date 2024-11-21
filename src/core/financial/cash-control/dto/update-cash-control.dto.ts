import { PartialType } from '@nestjs/mapped-types';
import { CreateCashControlDto } from './create-cash-control.dto';

export class UpdateCashControlDto extends PartialType(CreateCashControlDto) {}

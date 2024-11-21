import { PartialType } from '@nestjs/mapped-types';
import { CreateScheduledExpenseDto } from './create-scheduled-expense.dto';

export class UpdateScheduledExpenseDto extends PartialType(
  CreateScheduledExpenseDto,
) {}

import { Module } from '@nestjs/common';
import { ReceivableModule } from './receivable/receivable.module';
import { PayableModule } from './payable/payable.module';
import { FlowModule } from './flow/flow.module';
import { CashControlModule } from './cash-control/cash-control.module';
import { ScheduledExpenseModule } from './scheduled-expense/scheduled-expense.module';
import { InvoiceModule } from './invoice/invoice.module';
import { SalariesModule } from './salaries/salaries.module';

@Module({
  imports: [
    ReceivableModule,
    PayableModule,
    FlowModule,
    CashControlModule,
    ScheduledExpenseModule,
    InvoiceModule,
    SalariesModule,
  ],
  exports: [
    ReceivableModule,
    PayableModule,
    FlowModule,
    CashControlModule,
    ScheduledExpenseModule,
    InvoiceModule,
  ],
})
export class FinancialModule {}

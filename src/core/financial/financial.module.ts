import { Module } from '@nestjs/common';
import { ReceivableModule } from './receivable/receivable.module';
import { PayableModule } from './payable/payable.module';
import { FlowModule } from './flow/flow.module';
import { CashControlModule } from './cash-control/cash-control.module';
import { ScheduledExpenseModule } from './scheduled-expense/scheduled-expense.module';
import { InvoiceModule } from './invoice/invoice.module';
import { SalarySheetsModule } from './salary-sheets/salary-sheets.module';
import { NatureModule } from './nature/nature.module';
import { CreditLimitModule } from './credit-limit/credit-limit.module';
import { SalariesModule } from './salaries/salaries.module';

@Module({
  imports: [
    ReceivableModule,
    PayableModule,
    FlowModule,
    CashControlModule,
    ScheduledExpenseModule,
    InvoiceModule,
    SalarySheetsModule,
    NatureModule,
    CreditLimitModule,
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

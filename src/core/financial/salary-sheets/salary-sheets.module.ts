import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SalarySheetsController } from './salary-sheets.controller';
import { SalarySheetsService } from './salary-sheets.service';
import { SalaryExpenseService } from './salary-expense.service';
import { SalaryPdfService } from './salary-pdf.service';

@Module({
  imports: [PrismaModule],
  controllers: [SalarySheetsController],
  providers: [SalarySheetsService, SalaryExpenseService, SalaryPdfService],
})
export class SalarySheetsModule {}

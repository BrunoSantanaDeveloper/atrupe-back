import { Module } from '@nestjs/common';
import { SalarySheetController } from './salaries.controller';
import { SalarySheetService } from './salaries.service';

@Module({
  controllers: [SalarySheetController],
  providers: [SalarySheetService],
})
export class SalariesModule {}

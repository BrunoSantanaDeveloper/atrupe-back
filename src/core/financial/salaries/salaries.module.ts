import { Module } from '@nestjs/common';
import { SalariesService } from './salaries.service';
import { SalariesController } from './salaries.controller';
import { SalaryTemplatesService } from './salary-templates.service';

@Module({
  controllers: [SalariesController],
  providers: [SalariesService, SalaryTemplatesService],
  exports: [SalaryTemplatesService],
})
export class SalariesModule {}

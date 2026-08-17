import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SalariesService } from './salaries.service';
import { SalariesController } from './salaries.controller';
import { SalaryTemplatesService } from './salary-templates.service';
import { PayrollTemplatesController } from './payroll-templates.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SalariesController, PayrollTemplatesController],
  providers: [SalariesService, SalaryTemplatesService],
  exports: [SalaryTemplatesService],
})
export class SalariesModule {}

import { Module } from '@nestjs/common';
import { EmployeeService } from './employee.service';
import { EmployeeController } from './employee.controller';
import { PrismaModule } from 'nestjs-prisma';
import { SalariesModule } from '../financial/salaries/salaries.module';
import { EmployeeHistoryModule } from './history/history.module';

@Module({
  imports: [PrismaModule, SalariesModule, EmployeeHistoryModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
})
export class EmployeeModule {}

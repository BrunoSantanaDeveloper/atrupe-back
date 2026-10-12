import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SalariesService } from './salaries.service';
import { SalariesController } from './salaries.controller';
import { SalaryTemplatesService } from './salary-templates.service';
import { PayrollTemplatesController } from './payroll-templates.controller';
import { AuthModule } from 'src/core/auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [SalariesController, PayrollTemplatesController],
  providers: [SalariesService, SalaryTemplatesService],
  exports: [SalaryTemplatesService],
})
export class SalariesModule {}

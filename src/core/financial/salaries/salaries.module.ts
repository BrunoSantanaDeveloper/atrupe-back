import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SalariesService } from './salaries.service';
import { SalariesController } from './salaries.controller';
import { SalaryTemplatesService } from './salary-templates.service';
import { PayrollTemplatesController } from './payroll-templates.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { CostAuditModule } from '../../cost-base/cost-audit.module';
import { PayrollStructureService } from './payroll-structure.service';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule, CostAuditModule],
  controllers: [SalariesController, PayrollTemplatesController],
  providers: [SalariesService, SalaryTemplatesService, PayrollStructureService],
  exports: [SalaryTemplatesService, PayrollStructureService],
})
export class SalariesModule {}

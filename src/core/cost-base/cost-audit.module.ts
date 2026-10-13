import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { CostAuditService } from './cost-audit.service';

@Module({
  imports: [PrismaModule],
  providers: [CostAuditService],
  exports: [CostAuditService],
})
export class CostAuditModule {}

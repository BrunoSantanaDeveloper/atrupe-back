import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { CostAuditModule } from './cost-audit.module';
import { CostBaseSnapshotService } from './cost-base-snapshot.service';
import { CostBaseController } from './cost-base.controller';
import { CostBaseService } from './cost-base.service';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule, CostAuditModule],
  controllers: [CostBaseController],
  providers: [CostBaseService, CostBaseSnapshotService],
  exports: [CostBaseSnapshotService],
})
export class CostBaseModule {}

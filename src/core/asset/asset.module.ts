import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { CostAuditModule } from '../cost-base/cost-audit.module';
import { AssetGroupService } from './asset-group.service';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

@Module({
  imports: [AuthModule, PrismaModule, CostAuditModule],
  controllers: [AssetController],
  providers: [AssetService, AssetGroupService],
  exports: [AssetService, AssetGroupService],
})
export class AssetModule {}

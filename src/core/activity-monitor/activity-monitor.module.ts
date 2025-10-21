import { Module } from '@nestjs/common';
import { ActivityMonitorService } from './activity-monitor.service';
import { ActivityMonitorController } from './activity-monitor.controller';
import { ActivityCleanupTask } from './tasks/activity-cleanup.task';
import { PrismaService } from '../../config/prisma/prisma.service';

@Module({
  controllers: [ActivityMonitorController],
  providers: [ActivityMonitorService, ActivityCleanupTask, PrismaService],
  exports: [ActivityMonitorService],
})
export class ActivityMonitorModule {}

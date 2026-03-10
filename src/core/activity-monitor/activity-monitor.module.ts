import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ActivityMonitorService } from './activity-monitor.service';
import { ActivityMonitorController } from './activity-monitor.controller';
import { ActivityCleanupTask } from './tasks/activity-cleanup.task';

@Module({
  imports: [PrismaModule],
  controllers: [ActivityMonitorController],
  providers: [ActivityMonitorService, ActivityCleanupTask],
  exports: [ActivityMonitorService],
})
export class ActivityMonitorModule {}

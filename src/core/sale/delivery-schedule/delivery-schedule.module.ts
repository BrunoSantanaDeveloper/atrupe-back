import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { DeliveryScheduleController } from './delivery-schedule.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [DeliveryScheduleController],
  providers: [DeliveryScheduleService],
  exports: [DeliveryScheduleService],
})
export class DeliveryScheduleModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { DeliveryScheduleController } from './delivery-schedule.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DeliveryScheduleController],
  providers: [DeliveryScheduleService],
  exports: [DeliveryScheduleService],
})
export class DeliveryScheduleModule {}

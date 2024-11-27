import { Module } from '@nestjs/common';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { DeliveryScheduleController } from './delivery-schedule.controller';

@Module({
  controllers: [DeliveryScheduleController],
  providers: [DeliveryScheduleService],
})
export class DeliveryScheduleModule {}

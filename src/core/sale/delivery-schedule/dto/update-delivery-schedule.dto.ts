import { PartialType } from '@nestjs/swagger';
import { CreateDeliveryScheduleDto } from './create-delivery-schedule.dto';

export class UpdateDeliveryScheduleDto extends PartialType(
  CreateDeliveryScheduleDto,
) {}

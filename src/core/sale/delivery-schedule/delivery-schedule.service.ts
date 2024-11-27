import { Injectable } from '@nestjs/common';

import { CreateDeliveryScheduleDto } from './dto/create-delivery-schedule.dto';
import { UpdateDeliveryScheduleDto } from './dto/update-delivery-schedule.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';

@Injectable()
export class DeliveryScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  create(createDeliveryScheduleDto: CreateDeliveryScheduleDto) {
    return this.prisma.deliverySchedule.create({
      data: createDeliveryScheduleDto,
    });
  }

  findAll() {
    return this.prisma.deliverySchedule.findMany();
  }

  findOne(id: string) {
    return this.prisma.deliverySchedule.findUnique({ where: { id } });
  }

  update(id: string, updateDeliveryScheduleDto: UpdateDeliveryScheduleDto) {
    return this.prisma.deliverySchedule.update({
      where: { id },
      data: updateDeliveryScheduleDto,
    });
  }

  remove(id: string) {
    return this.prisma.deliverySchedule.delete({ where: { id } });
  }
}

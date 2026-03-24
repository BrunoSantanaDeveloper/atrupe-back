import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';

import { AuthModule } from '../../../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}

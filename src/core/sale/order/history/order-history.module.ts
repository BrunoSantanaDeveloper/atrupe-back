import { Module } from '@nestjs/common';
import { OrderHistoryService } from './order-history.service';
import { OrderHistoryController } from './order-history.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [OrderHistoryController],
  providers: [OrderHistoryService],
  exports: [OrderHistoryService],
})
export class OrderHistoryModule {}

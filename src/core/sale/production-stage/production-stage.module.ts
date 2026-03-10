import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ProductionStageService } from './production-stage.service';
import { ProductionStageController } from './production-stage.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProductionStageController],
  providers: [ProductionStageService],
})
export class ProductionStageModule {}

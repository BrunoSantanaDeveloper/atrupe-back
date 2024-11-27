import { Module } from '@nestjs/common';
import { ProductionStageService } from './production-stage.service';
import { ProductionStageController } from './production-stage.controller';

@Module({
  controllers: [ProductionStageController],
  providers: [ProductionStageService],
})
export class ProductionStageModule {}

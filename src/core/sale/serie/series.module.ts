import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { SaleSeriesController } from './series.controller';
import { SaleSeriesService } from './series.service';

@Module({
  imports: [AuthModule],
  controllers: [SaleSeriesController],
  providers: [SaleSeriesService],
  exports: [SaleSeriesService],
})
export class SeriesModule {}

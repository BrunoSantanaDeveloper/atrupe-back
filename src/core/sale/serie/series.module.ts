import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { SaleSeriesController } from './series.controller';
import { SaleSeriesService } from './series.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SaleSeriesController],
  providers: [SaleSeriesService],
  exports: [SaleSeriesService],
})
export class SeriesModule {}

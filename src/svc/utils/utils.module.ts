import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { UtilsController } from './utils.controller';
import { PlugModule } from '../plug/plug.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule, PlugModule],
  controllers: [UtilsController],
  providers: [UtilsService],
  exports: [UtilsService],
})
export class UtilsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { SalesSettingsController } from './sales-settings.controller';
import { SalesSettingsService } from './sales-settings.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SalesSettingsController],
  providers: [SalesSettingsService],
  exports: [SalesSettingsService],
})
export class SalesSettingsModule {}

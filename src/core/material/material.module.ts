import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PricingModule } from '../pricing/pricing.module';
import { MaterialController } from './material.controller';
import { MaterialImportService } from './material-import.service';
import { MaterialService } from './material.service';

@Module({
  imports: [AuthModule, PrismaModule, PricingModule],
  controllers: [MaterialController],
  providers: [MaterialService, MaterialImportService],
  exports: [MaterialService],
})
export class MaterialModule {}

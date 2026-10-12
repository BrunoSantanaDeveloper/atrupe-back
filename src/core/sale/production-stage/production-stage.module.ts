import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ProductionStageService } from './production-stage.service';
import { ProductionStageController } from './production-stage.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [ProductionStageController],
  providers: [ProductionStageService],
})
export class ProductionStageModule {}

import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { UtilsController } from './utils.controller';
import { PlugModule } from '../plug/plug.module';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from 'src/core/auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [PrismaModule, PlugModule, AuthModule],
  controllers: [UtilsController],
  providers: [UtilsService],
  exports: [UtilsService],
})
export class UtilsModule {}

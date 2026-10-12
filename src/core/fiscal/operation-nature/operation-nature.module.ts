import { Module } from '@nestjs/common';
import { OperationNatureService } from './operation-nature.service';
import { OperationNatureController } from './operation-nature.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [OperationNatureController],
  providers: [OperationNatureService],
  exports: [OperationNatureService],
})
export class OperationNatureModule {}

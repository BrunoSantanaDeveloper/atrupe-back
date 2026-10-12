import { Module } from '@nestjs/common';

import { PrismaModule } from 'nestjs-prisma';
import { CancelReasonController } from './cancel-reason.controller';
import { CancelReasonService } from './cancel-reason.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [CancelReasonController],
  providers: [CancelReasonService],
})
export class CancelReasonModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { StatusService } from './status.service';
import { StatusController } from './status.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}

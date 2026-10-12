import { Module } from '@nestjs/common';
import { CfopService } from './cfop.service';
import { CfopController } from './cfop.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [CfopController],
  providers: [CfopService],
  exports: [CfopService],
})
export class CfopModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { NatureService } from './nature.service';
import { NatureController } from './nature.controller';
import { AuthModule } from 'src/core/auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [NatureController],
  providers: [NatureService],
})
export class NatureModule {}

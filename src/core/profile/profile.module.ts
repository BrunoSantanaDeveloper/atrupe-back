import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { ContactSourceController } from './contact-source.controller';
import { ContactSourceService } from './contact-source.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [ContactSourceController],
  providers: [ContactSourceService],
})
export class ContactSourceModule {}

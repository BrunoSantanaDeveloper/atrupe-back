import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from 'nestjs-prisma';
import { CacheModule } from 'src/svc/cache/cache.module';
import { PlugModule } from 'src/svc/plug/plug.module';
import { AbacService } from '../auth/abac/abac.service';

@Module({
  imports: [PrismaModule, CacheModule, PlugModule],
  controllers: [UserController],
  providers: [UserService, AbacService],
  exports: [UserService],
})
export class UserModule {}

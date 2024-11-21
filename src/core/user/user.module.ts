import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from 'nestjs-prisma';
import { CacheModule } from 'src/svc/cache/cache.module';
import { PlugModule } from 'src/svc/plug/plug.module';

@Module({
  imports: [PrismaModule, CacheModule, PlugModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}

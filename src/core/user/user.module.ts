import { Module, forwardRef } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from 'nestjs-prisma';
import { CacheModule } from 'src/svc/cache/cache.module';
import { PlugModule } from 'src/svc/plug/plug.module';
import { AbacService } from '../auth/abac/abac.service';
import { CompanyModule } from '../company/company.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    PlugModule,
    forwardRef(() => CompanyModule),
  ],
  controllers: [UserController],
  providers: [UserService, AbacService],
  exports: [UserService],
})
export class UserModule {}

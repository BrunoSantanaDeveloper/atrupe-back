import { Module, forwardRef } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from 'nestjs-prisma';
import { CacheModule } from 'src/svc/cache/cache.module';
import { PlugModule } from 'src/svc/plug/plug.module';
import { AbacService } from '../auth/abac/abac.service';
import { CompanyModule } from '../company/company.module';
import { EmployeeHistoryModule } from '../employee/history/history.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    ThrottlerModule.forRoot([
      {
        name: 'public',
        ttl: 60000,
        limit: 3, // 3 requests per 60s for public user endpoints
      },
    ]),
    PlugModule,
    forwardRef(() => CompanyModule),
    EmployeeHistoryModule,
  ],
  controllers: [UserController],
  providers: [UserService, AbacService],
  exports: [UserService],
})
export class UserModule {}

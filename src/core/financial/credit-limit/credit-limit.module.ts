import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { CreditLimitService } from './credit-limit.service';
import { CreditLimitController } from './credit-limit.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [CreditLimitController],
  providers: [CreditLimitService],
})
export class CreditLimitModule {}

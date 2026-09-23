import { Module, forwardRef } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from './constants';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { AbacService } from './abac/abac.service';
import { TenantGuard } from './guards/tenant.guard';
import { PrismaModule } from 'nestjs-prisma';
import { PlanControlModule } from '../plan/plan-control.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ActivityMonitorModule } from '../activity-monitor/activity-monitor.module';
import { SessionAccessService } from './session-access.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      global: true,
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '4h' },
    }),
    forwardRef(() => UserModule),
    PlanControlModule,
    forwardRef(() => SubscriptionsModule),
    ActivityMonitorModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AbacService,
    TenantGuard,
    JwtStrategy,
    JwtRefreshStrategy,
    LocalStrategy,
    SessionAccessService,
  ],
  exports: [AuthService, AbacService, TenantGuard, SessionAccessService],
})
export class AuthModule {}

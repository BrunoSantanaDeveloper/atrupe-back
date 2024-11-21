import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { jwtConstants } from './constants';
import { UserModule } from '../user/user.module';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { AbacService } from './abac/abac.service';
import { PrismaModule } from 'nestjs-prisma';
@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      global: true,
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '60d' },
    }),
    UserModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AbacService, JwtStrategy, LocalStrategy],
  exports: [AuthService, AbacService],
})
export class AuthModule {}

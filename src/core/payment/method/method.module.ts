import { Module } from '@nestjs/common';
import { MethodService } from './method.service';
import { MethodController } from './method.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MethodController],
  providers: [MethodService],
})
export class MethodModule {}

import { Module } from '@nestjs/common';
import { ConditionService } from './condition.service';
import { ConditionController } from './condition.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ConditionController],
  providers: [ConditionService],
})
export class ConditionModule {}

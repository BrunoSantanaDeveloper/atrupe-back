import { Module } from '@nestjs/common';
import { ScheduledExpenseService } from './scheduled-expense.service';
import { ScheduledExpenseController } from './scheduled-expense.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ScheduledExpenseController],
  providers: [ScheduledExpenseService],
})
export class ScheduledExpenseModule {}

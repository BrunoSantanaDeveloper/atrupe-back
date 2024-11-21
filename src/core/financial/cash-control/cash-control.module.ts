import { Module } from '@nestjs/common';
import { CashControlService } from './cash-control.service';
import { CashControlController } from './cash-control.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CashControlController],
  providers: [CashControlService],
})
export class CashControlModule {}

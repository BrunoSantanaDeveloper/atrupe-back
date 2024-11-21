import { Module } from '@nestjs/common';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { AccountService } from './account.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BankController],
  providers: [BankService, AccountService],
})
export class BankModule {}

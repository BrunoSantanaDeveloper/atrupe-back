import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { CreditLimitService } from './credit-limit.service';
import { CreditLimitController } from './credit-limit.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CreditLimitController],
  providers: [CreditLimitService],
})
export class CreditLimitModule {}

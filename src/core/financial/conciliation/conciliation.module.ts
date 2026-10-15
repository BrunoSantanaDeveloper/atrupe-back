import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { CashControlModule } from '../cash-control/cash-control.module';
import { ConciliationController } from './conciliation.controller';
import { ConciliationService } from './conciliation.service';

/** A conciliação com o extrato em OFX (CX-6, LITE). */
@Module({
  imports: [AuthModule, PrismaModule, CashControlModule],
  controllers: [ConciliationController],
  providers: [ConciliationService],
})
export class ConciliationModule {}

import { Module } from '@nestjs/common';
import { ReceivableService } from './receivable.service';
import { ReceivableController } from './receivable.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ReceivableController],
  providers: [ReceivableService],
  exports: [ReceivableService],
})
export class ReceivableModule {}

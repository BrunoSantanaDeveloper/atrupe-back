import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { SaleHistoryController } from './sale-history.controller';
import { SaleHistoryService } from './sale-history.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule],
  controllers: [SaleHistoryController],
  providers: [SaleHistoryService],
  exports: [SaleHistoryService],
})
export class SaleHistoryModule {}

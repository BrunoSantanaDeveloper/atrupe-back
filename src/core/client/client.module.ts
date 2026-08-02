import { Module } from '@nestjs/common';
import { ClientService } from './client.service';
import { ClientController } from './client.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PlugModule } from '../../svc/plug/plug.module';
import { PlanControlModule } from '../plan/plan-control.module';

@Module({
  imports: [PrismaModule, AuthModule, PlugModule, PlanControlModule],
  controllers: [ClientController],
  providers: [ClientService],
  exports: [ClientService],
})
export class ClientModule {}

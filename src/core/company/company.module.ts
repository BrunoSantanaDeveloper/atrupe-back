import { Module } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { AddressModule } from '../address/address.module';
import { PlugModule } from '../../svc/plug/plug.module';
import { CancelReasonModule } from './cancel-reason/cancel-reason.module';
import { SupplierModule } from '../supplier/supplier.module';
import { ClientModule } from '../client/client.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AddressModule,
    PlugModule,
    CancelReasonModule,
    ClientModule,
    SupplierModule,
  ],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}

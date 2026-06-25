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
import { CompanySeedsService } from './company-seeds.service';
import { CompanyHistoryService } from './company-history.service';
import { FiscalSecurityModule } from '../fiscal/shared/fiscal-security.module';

@Module({
  imports: [
    FiscalSecurityModule,
    PrismaModule,
    AuthModule,
    AddressModule,
    PlugModule,
    CancelReasonModule,
    ClientModule,
    SupplierModule,
  ],
  controllers: [CompanyController],
  providers: [CompanyService, CompanySeedsService, CompanyHistoryService],
  exports: [CompanyService, CompanySeedsService, CompanyHistoryService],
})
export class CompanyModule {}

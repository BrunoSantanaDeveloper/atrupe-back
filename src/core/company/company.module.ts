import { Module } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { AddressModule } from '../address/address.module';
import { PlugModule } from '../../svc/plug/plug.module';

@Module({
  imports: [PrismaModule, AuthModule, AddressModule, PlugModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}

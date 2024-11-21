import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PlugModule } from '../../svc/plug/plug.module';
import { UtilsModule } from 'src/svc/utils/utils.module';

@Module({
  imports: [PrismaModule, AuthModule, PlugModule, UtilsModule],
  controllers: [AddressController],
  providers: [AddressService],
  exports: [AddressService],
})
export class AddressModule {}

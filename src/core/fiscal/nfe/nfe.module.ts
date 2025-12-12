import { Module } from '@nestjs/common';
import { NfeService } from './nfe.service';
import { NfeController } from './nfe.controller';
import { InvoicyModule } from '../invoicy/invoicy.module';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule, InvoicyModule],
  controllers: [NfeController],
  providers: [NfeService],
  exports: [NfeService],
})
export class NfeModule {}

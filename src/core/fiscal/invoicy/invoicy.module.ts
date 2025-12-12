import { Module } from '@nestjs/common';
import { InvoicyService } from './invoicy.service';
import { InvoicyController } from './invoicy.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [InvoicyController],
  providers: [InvoicyService],
  exports: [InvoicyService],
})
export class InvoicyModule {}

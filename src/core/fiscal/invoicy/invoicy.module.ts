import { Module } from '@nestjs/common';
import { InvoicyService } from './invoicy.service';
import { InvoicyController } from './invoicy.controller';

@Module({
  controllers: [InvoicyController],
  providers: [InvoicyService],
  exports: [InvoicyService],
})
export class InvoicyModule {}

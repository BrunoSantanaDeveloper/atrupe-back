import { Module } from '@nestjs/common';
import { InvoicyService } from './invoicy.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { InvoicyApiService } from './invoicy-api.service';
import { InvoicyController, EmissoresController } from './invoicy.controller';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [InvoicyController, EmissoresController],
  providers: [InvoicyService, InvoicyHttpService, InvoicyApiService],
  exports: [InvoicyService, InvoicyHttpService, InvoicyApiService],
})
export class InvoicyModule {}

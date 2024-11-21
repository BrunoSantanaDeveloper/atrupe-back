import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { AuthModule } from 'src/core/auth/auth.module';
import { PrismaModule } from 'nestjs-prisma';
import { PdfService } from 'src/svc/pdf/pdf.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, PdfService],
})
export class InvoiceModule {}

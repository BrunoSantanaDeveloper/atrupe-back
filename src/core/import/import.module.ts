import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { QuotationImportService } from './services/quotation-import.service';
import { PrismaModule } from 'nestjs-prisma';
import { MinioModule } from '../../svc/file-upload/minio.module';

@Module({
  imports: [PrismaModule, MinioModule],
  controllers: [ImportController],
  providers: [ImportService, QuotationImportService],
  exports: [ImportService, QuotationImportService],
})
export class ImportModule {}

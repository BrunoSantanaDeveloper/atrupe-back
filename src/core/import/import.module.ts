import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { QuotationImportService } from './services/quotation-import.service';
import { PrismaModule } from 'nestjs-prisma';
import { MinioModule } from '../../svc/file-upload/minio.module';
import { ProductFiscalModule } from '../fiscal/product-fiscal/product-fiscal.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // ProductFiscalModule: produtos importados recebem dados fiscais com os
  // mesmos defaults do cadastro via tela (getOrCreateWithDefaults).
  // AuthModule fornece o AbacService, exigido pelo PermissionsGuard
  imports: [AuthModule, PrismaModule, MinioModule, ProductFiscalModule],
  controllers: [ImportController],
  providers: [ImportService, QuotationImportService],
  exports: [ImportService, QuotationImportService],
})
export class ImportModule {}

import { Module, forwardRef } from '@nestjs/common';
import { InvoicyService } from './invoicy.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { InvoicyApiService } from './invoicy-api.service';
import { InvoicyController, EmissoresController } from './invoicy.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [InvoicyController, EmissoresController],
  providers: [InvoicyService, InvoicyHttpService, InvoicyApiService],
  exports: [InvoicyService, InvoicyHttpService, InvoicyApiService],
})
export class InvoicyModule {}

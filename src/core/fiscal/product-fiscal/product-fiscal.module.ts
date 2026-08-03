import { Module, forwardRef } from '@nestjs/common';
import { ProductFiscalService } from './product-fiscal.service';
import { ProductFiscalController } from './product-fiscal.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';

@Module({
  // AuthModule fornece AbacService, exigido pelo PermissionsGuard aplicado no
  // ProductFiscalController. forwardRef pelo mesmo motivo dos demais módulos
  // fiscais: AuthModule participa de ciclo de dependência.
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [ProductFiscalController],
  providers: [ProductFiscalService],
  exports: [ProductFiscalService],
})
export class ProductFiscalModule {}

import { Module, forwardRef } from '@nestjs/common';
import { ProductFiscalService } from './product-fiscal.service';
import { ProductFiscalController } from './product-fiscal.controller';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../../auth/auth.module';
import { PlanControlModule } from '../../plan/plan-control.module';
import { IcmsAliquotaInternaService } from '../shared/icms-aliquota-interna.service';

@Module({
  // AuthModule fornece AbacService, exigido pelo PermissionsGuard aplicado no
  // ProductFiscalController. forwardRef pelo mesmo motivo dos demais módulos
  // fiscais: AuthModule participa de ciclo de dependência.
  // PlanControlModule fornece PlanControlService, exigido pelo FeatureGuard que
  // trava as rotas na feature `nota_fiscal`.
  imports: [PrismaModule, forwardRef(() => AuthModule), PlanControlModule],
  controllers: [ProductFiscalController],
  // IcmsAliquotaInternaService é provido aqui (e não importado do
  // SystemSettingsModule) para não puxar aquele módulo inteiro só pela
  // alíquota sugerida na correção de tributação em massa. Ele só depende de
  // Prisma e não guarda estado, então uma segunda instância é inofensiva.
  providers: [ProductFiscalService, IcmsAliquotaInternaService],
  exports: [ProductFiscalService],
})
export class ProductFiscalModule {}

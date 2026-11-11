import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '../../../config/prisma/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { FiscalStandaloneDraftController } from './fiscal-standalone-draft.controller';
import { FiscalStandaloneDraftService } from './fiscal-standalone-draft.service';

@Module({
  // AuthModule entra porque o controller usa PermissionsGuard, que depende do
  // AbacService: sem ele o guard quebra em toda requisicao. O forwardRef segue
  // o padrao dos demais modulos fiscais.
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [FiscalStandaloneDraftController],
  providers: [FiscalStandaloneDraftService],
  exports: [FiscalStandaloneDraftService],
})
export class FiscalDraftModule {}

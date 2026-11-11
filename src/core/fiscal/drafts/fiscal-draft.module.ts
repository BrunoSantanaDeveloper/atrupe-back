import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../config/prisma/prisma.module';
import { FiscalStandaloneDraftController } from './fiscal-standalone-draft.controller';
import { FiscalStandaloneDraftService } from './fiscal-standalone-draft.service';

@Module({
  imports: [PrismaModule],
  controllers: [FiscalStandaloneDraftController],
  providers: [FiscalStandaloneDraftService],
  exports: [FiscalStandaloneDraftService],
})
export class FiscalDraftModule {}

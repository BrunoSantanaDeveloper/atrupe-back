import { Module } from '@nestjs/common';

import { PrismaModule } from 'nestjs-prisma';
import { CancelReasonController } from './cancel-reason.controller';
import { CancelReasonService } from './cancel-reason.service';

@Module({
  imports: [PrismaModule],
  controllers: [CancelReasonController],
  providers: [CancelReasonService],
})
export class CancelReasonModule {}

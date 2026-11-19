import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PlanControlModule } from '../plan/plan-control.module';
import { ReleaseNotesController } from './release-notes.controller';
import { ReleaseNotesService } from './release-notes.service';

/** As novidades do sistema: sino, aviso do painel e página Novidades. */
@Module({
  imports: [PrismaModule, PlanControlModule],
  controllers: [ReleaseNotesController],
  providers: [ReleaseNotesService],
})
export class ReleaseNotesModule {}

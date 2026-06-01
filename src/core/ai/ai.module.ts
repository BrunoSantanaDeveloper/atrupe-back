import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { ReportModule } from '../../svc/report/report.module';
import { AiController } from './ai.controller';
import { AiModelSelectionService } from './ai-model-selection.service';
import { AiSafetyService } from './ai-safety.service';
import { AiService } from './ai.service';
import { AiToolRegistry } from './ai-tool-registry.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { OpenRouterAiProvider } from './providers/openrouter-ai.provider';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule,
    PrismaModule,
    AuthModule,
    ReportModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiModelSelectionService,
    AiSafetyService,
    AiToolRegistry,
    OpenRouterAiProvider,
    {
      provide: AI_PROVIDER,
      useExisting: OpenRouterAiProvider,
    },
  ],
})
export class AiModule {}

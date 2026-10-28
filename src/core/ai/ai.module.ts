import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { AcademyModule } from '../academy/academy.module';
import { FiscalOnboardingModule } from '../fiscal/onboarding/fiscal-onboarding.module';
import { PlanControlModule } from '../plan/plan-control.module';
import { ReportModule } from '../../svc/report/report.module';
import { QuotationModule } from '../sale/quotation/quotation.module';
import { AiController } from './ai.controller';
import { AiActionService } from './ai-action.service';
import { AiQuotationDraftService } from './ai-quotation-draft.service';
import { AiHelpContentService } from './ai-help-content.service';
import { AiModelSelectionService } from './ai-model-selection.service';
import { AiOperationalQueryService } from './ai-operational-query.service';
import { AiRegistrationQueryService } from './ai-registration-query.service';
import { AiSafetyService } from './ai-safety.service';
import { AiService } from './ai.service';
import { AiToolRegistry } from './ai-tool-registry.service';
import { AiUsageService } from './ai-usage.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { OpenRouterAiProvider } from './providers/openrouter-ai.provider';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule,
    PrismaModule,
    AuthModule,
    AcademyModule,
    FiscalOnboardingModule,
    PlanControlModule,
    ReportModule,
    // O "Aplicar" do rascunho grava pelos serviços do orçamento
    QuotationModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiActionService,
    AiQuotationDraftService,
    AiModelSelectionService,
    AiHelpContentService,
    AiOperationalQueryService,
    AiRegistrationQueryService,
    AiSafetyService,
    AiToolRegistry,
    AiUsageService,
    OpenRouterAiProvider,
    {
      provide: AI_PROVIDER,
      useExisting: OpenRouterAiProvider,
    },
  ],
})
export class AiModule {}

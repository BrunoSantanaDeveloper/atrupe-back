import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AtendimentoEquipeCron } from './atendimento-equipe.cron';
import { AtendimentoRoboController } from './atendimento-robo.controller';
import { AtendimentoTools } from './atendimento-tools';
import { AtendimentoController } from './atendimento.controller';
import {
  ATENDIMENTO_KIT,
  AtendimentoService,
  defaultKitSource,
} from './atendimento.service';
import { AtendimentoStore } from './atendimento.store';

/**
 * Atendimento do Atrupe pelo WhatsApp, com robô de IA e a equipe, sobre o
 * Chatwoot (kit em `atendimento/`, na raiz do repositório). O
 * `EncryptionService` vem do `FiscalSecurityModule`, que é global.
 */
@Module({
  imports: [SubscriptionsModule],
  controllers: [AtendimentoController, AtendimentoRoboController],
  providers: [
    AtendimentoStore,
    AtendimentoTools,
    AtendimentoService,
    AtendimentoEquipeCron,
    { provide: ATENDIMENTO_KIT, useValue: defaultKitSource },
  ],
})
export class AtendimentoModule {}

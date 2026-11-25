import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AtendimentoContatoController } from './atendimento-contato.controller';
import { AtendimentoEquipeCron } from './atendimento-equipe.cron';
import { AtendimentoNumeroCron } from './atendimento-numero.cron';
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
  imports: [SubscriptionsModule, MailModule],
  controllers: [
    AtendimentoContatoController,
    AtendimentoController,
    AtendimentoRoboController,
  ],
  providers: [
    AtendimentoStore,
    AtendimentoTools,
    AtendimentoService,
    AtendimentoEquipeCron,
    AtendimentoNumeroCron,
    { provide: ATENDIMENTO_KIT, useValue: defaultKitSource },
  ],
})
export class AtendimentoModule {}

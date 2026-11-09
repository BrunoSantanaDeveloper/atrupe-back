import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AtendimentoService,
  atendimentoConfigurado,
} from './atendimento.service';

/**
 * A sessão do painel do Chatwoot dura até 2 meses: quem deixou de ser
 * superadmin ativo precisa sair da conta do atendimento mesmo sem tentar
 * entrar de novo. Uma vez por dia, a equipe do Chatwoot é conferida com a do
 * Atrupe. Quem está na conta sem ter sido posto pelo sistema não é tirado:
 * fica no log para alguém olhar.
 */
@Injectable()
export class AtendimentoEquipeCron {
  private readonly logger = new Logger(AtendimentoEquipeCron.name);

  constructor(private readonly atendimento: AtendimentoService) {}

  @Cron('20 4 * * *', {
    name: 'atendimento-equipe',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    if (!atendimentoConfigurado()) return;
    try {
      const result = await this.atendimento.syncPanelStaff();
      if (result.skipped) {
        this.logger.log(
          `Equipe do atendimento não conferida: ${result.skipped}`,
        );
        return;
      }
      if (result.removed.length) {
        this.logger.log(
          `Equipe do atendimento: ${result.removed.length} pessoa(s) tirada(s) do painel.`,
        );
      }
      if (result.unknown.length) {
        this.logger.warn(
          `Equipe do atendimento: ${result.unknown.length} pessoa(s) na conta do Chatwoot sem vínculo com o Atrupe (ids ${result.unknown
            .map((item) => `${item.user_id}/${item.role ?? '?'}`)
            .join(', ')}). Confira no painel e tire à mão se for o caso.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Conferência da equipe do atendimento falhou: ${(error as { code?: string }).code ?? (error as Error).message}`,
      );
    }
  }
}

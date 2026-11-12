import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AtendimentoService,
  atendimentoConfigurado,
} from './atendimento.service';

/**
 * Sem esta rotina, um número que cai só aparece quando um cliente reclama: o
 * painel fica vazio, como num dia sem conversas. A cada 15 minutos ela confere
 * o número, e o serviço avisa os superadmins por e-mail. Na mesma volta, leva
 * ao OpenWA a escolha sobre os grupos do WhatsApp (e dá nome aos grupos novos
 * no painel) e reabre os grupos da equipe que a resolução automática fechou.
 *
 * Roda em uma réplica só (a API tem uma, nos dois stacks): duas ao mesmo tempo
 * mandariam o aviso duas vezes. O máximo que acontece é repetir um e-mail se a
 * conferência cair na troca de contêiner de um deploy.
 */
@Injectable()
export class AtendimentoNumeroCron {
  private readonly logger = new Logger(AtendimentoNumeroCron.name);
  private running = false;

  constructor(private readonly atendimento: AtendimentoService) {}

  @Cron('*/15 * * * *', {
    name: 'atendimento-numero',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    if (!atendimentoConfigurado() || this.running) return;
    this.running = true;
    try {
      const { report, alerts } = await this.atendimento.checkWhatsapp();
      for (const alert of alerts) {
        this.logger.log(
          `Número do atendimento: aviso "${alert.kind}" enviado (caixa ${alert.inbox_id}, ${alert.level}).`,
        );
      }
      if (report && report.level !== 'ok') {
        const codes = report.inboxes
          .flatMap((inbox) => inbox.findings.map((item) => item.code))
          .join(', ');
        this.logger.warn(`Número do atendimento: ${report.level} (${codes}).`);
      }
    } catch (error) {
      // O aviso não saiu e a memória não foi gravada: volta na próxima.
      this.logger.error(
        `Conferência do número do atendimento falhou: ${(error as { code?: string }).code ?? (error as Error).message}`,
      );
    }
    // Cada parte por si: um OpenWA fora do ar não impede a conferência dos
    // grupos da equipe, que só falam com o Chatwoot.
    try {
      const groups = await this.atendimento.syncWhatsappGroups();
      if ('changed' in groups && (groups.changed || groups.renamed)) {
        this.logger.log(
          `Grupos do WhatsApp: repasse ${groups.mode === 'fora' ? 'desligado' : 'ligado'} (${groups.changed} sessão(ões) mudada(s), ${groups.renamed} grupo(s) renomeado(s)).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Grupos do WhatsApp não conferidos: ${(error as { code?: string }).code ?? (error as Error).message}`,
      );
    }
    try {
      const team = await this.atendimento.syncTeamGroups();
      if (team.reopened.length || team.pruned.length) {
        this.logger.log(
          `Grupos da equipe: ${team.reopened.length} reaberto(s), ${team.pruned.length} com gente que saiu da equipe.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Grupos da equipe não conferidos: ${(error as { code?: string }).code ?? (error as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}

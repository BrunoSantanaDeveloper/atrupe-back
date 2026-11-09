import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AtendimentoService,
  atendimentoConfigurado,
} from './atendimento.service';

/**
 * Sem esta rotina, um número que cai só aparece quando um cliente reclama: o
 * painel fica vazio, como num dia sem conversas. A cada 15 minutos ela confere
 * o número, e o serviço avisa os superadmins por e-mail.
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
    } finally {
      this.running = false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityMonitorService } from '../activity-monitor.service';

@Injectable()
export class ActivityCleanupTask {
  private readonly logger = new Logger(ActivityCleanupTask.name);

  constructor(
    private readonly activityMonitorService: ActivityMonitorService,
  ) {}

  /**
   * Executa a cada 15 minutos para marcar sessões inativas
   * Sessões sem atividade por mais de 10 minutos são marcadas como inativas
   */
  @Cron('*/15 * * * *')
  async cleanInactiveSessions() {
    this.logger.log('Iniciando limpeza de sessões inativas...');

    try {
      // Marcar como inativas sessões sem atividade há mais de 10 minutos (0.00694 dias ≈ 10min)
      const count =
        await this.activityMonitorService.cleanInactiveSessions(0.00694);

      this.logger.log(`${count} sessões marcadas como inativas`);
    } catch (error) {
      this.logger.error('Erro ao limpar sessões inativas:', error);
    }
  }

  /**
   * Executa diariamente à meia-noite para deletar registros antigos
   * Remove atividades com mais de 7 dias
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async deleteOldActivities() {
    this.logger.log('Iniciando exclusão de atividades antigas...');

    try {
      const count = await this.activityMonitorService.deleteOldActivities(7);

      this.logger.log(`${count} registros de atividades deletados`);
    } catch (error) {
      this.logger.error('Erro ao deletar atividades antigas:', error);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'nestjs-prisma';
import { NfceStatus } from '@prisma/client';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { InvoicyService } from '../invoicy/invoicy.service';
import { INVOICY_SUCCESS_CODES } from '../invoicy/invoicy.types';
import {
  isHistoricalDocument,
  loadFiscalHistoryLock,
} from '../shared/fiscal-history-lock';

/**
 * NfceContingencySyncService - Sincronização de NFC-e em contingência
 *
 * Este service é responsável por:
 * - Periodicamente buscar NFC-e em status CONTINGENCY
 * - Tentar transmitir para a SEFAZ
 * - Atualizar status conforme resultado
 *
 * A contingência offline ocorre quando:
 * - SEFAZ está fora do ar
 * - Problemas de conectividade
 * - Modo contingência ativado manualmente
 *
 * O job roda a cada 5 minutos tentando sincronizar as notas pendentes.
 */
@Injectable()
export class NfceContingencySyncService {
  private readonly logger = new Logger(NfceContingencySyncService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicyService: InvoicyService,
    private readonly invoicyApiService: InvoicyApiService,
  ) {}

  /**
   * Job agendado para sincronizar NFC-e em contingência
   * Executa a cada 5 minutos
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async syncContingencyNfces(): Promise<void> {
    // Evitar execuções paralelas
    if (this.isRunning) {
      this.logger.debug('Sync já em execução, pulando...');
      return;
    }

    this.isRunning = true;

    try {
      this.logger.log('Iniciando sincronização de NFC-e em contingência...');

      // Buscar todas as NFC-e em contingência (limite de 50 por execução)
      const contingencyNfces = await this.prisma.nfce.findMany({
        where: {
          status: NfceStatus.CONTINGENCY,
        },
        take: 50,
        orderBy: { createdAt: 'asc' }, // Processar mais antigas primeiro
        include: {
          company: {
            include: {
              address: true,
            },
          },
        },
      });

      if (contingencyNfces.length === 0) {
        this.logger.debug('Nenhuma NFC-e em contingência para sincronizar');
        return;
      }

      this.logger.log(
        `Encontradas ${contingencyNfces.length} NFC-e em contingência`,
      );

      // Agrupar por empresa para processar em lote
      const nfcesByCompany = this.groupByCompany(contingencyNfces);

      // Processar cada empresa
      for (const [companyId, nfces] of Object.entries(nfcesByCompany)) {
        await this.processCompanyNfces(companyId, nfces);
      }

      this.logger.log('Sincronização de NFC-e em contingência concluída');
    } catch (error) {
      this.logger.error(
        `Erro na sincronização de contingência: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Processa NFC-e de uma empresa específica
   */
  private async processCompanyNfces(
    companyId: string,
    todas: any[],
  ): Promise<void> {
    try {
      // NFC-e do CNPJ anterior a uma transferência de titularidade não é
      // transmitida: as credenciais de hoje são do CNPJ novo.
      const historico = await loadFiscalHistoryLock(this.prisma, companyId);
      const nfces = todas.filter(
        (nfce) => !isHistoricalDocument(nfce, historico),
      );
      if (nfces.length === 0) return;

      // Verificar se a empresa tem configuração ativa
      const config = await this.invoicyService.getConfig(companyId);
      if (!config || !config.isActive) {
        this.logger.warn(`Empresa ${companyId} sem configuração Invoicy ativa`);
        return;
      }

      // Verificar se a SEFAZ está disponível (tentar uma consulta simples)
      const sefazAvailable = await this.checkSefazAvailability(companyId);
      if (!sefazAvailable) {
        this.logger.warn(
          `SEFAZ indisponível para empresa ${companyId}, aguardando próximo ciclo`,
        );
        return;
      }

      this.logger.log(
        `Processando ${nfces.length} NFC-e da empresa ${companyId}`,
      );

      // Processar cada NFC-e
      for (const nfce of nfces) {
        await this.syncSingleNfce(companyId, nfce);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao processar empresa ${companyId}: ${error.message}`,
      );
    }
  }

  /**
   * Sincroniza uma única NFC-e
   */
  private async syncSingleNfce(companyId: string, nfce: any): Promise<void> {
    try {
      this.logger.log(`Sincronizando NFC-e ${nfce.numero} (${nfce.id})`);

      // Verificar se já foi muito tempo desde a emissão (não tentar após 24h)
      const horasDaEmissao =
        (Date.now() - new Date(nfce.dataEmissao || nfce.createdAt).getTime()) /
        (1000 * 60 * 60);
      if (horasDaEmissao > 24) {
        this.logger.warn(
          `NFC-e ${nfce.numero} expirou (${horasDaEmissao.toFixed(1)}h). Marcando como rejeitada.`,
        );
        await this.markAsExpired(nfce.id);
        return;
      }

      // Tentar transmitir via Invoicy
      // Note: A NFC-e em contingência já foi gravada no sistema
      // Precisamos apenas enviar para a SEFAZ
      const invoicyResponses = await this.invoicyApiService.syncContingency(
        companyId,
        nfce.chaveAcesso || nfce.id,
      );

      const response = invoicyResponses[0];
      if (!response) {
        this.logger.warn(`Sem resposta do Invoicy para NFC-e ${nfce.numero}`);
        return;
      }

      if (response.Codigo === INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED) {
        const doc = response.Documentos?.[0];
        const situacao = doc?.Situacao;
        const isAuthorized =
          situacao?.SitCodigo === 100 || situacao?.SitCodigo === 150;

        if (isAuthorized) {
          await this.markAsAuthorized(nfce.id, doc);
          this.logger.log(`NFC-e ${nfce.numero} autorizada com sucesso!`);
        } else {
          await this.markAsRejected(
            nfce.id,
            situacao?.SitDescricao || 'Rejeitada pela SEFAZ',
          );
          this.logger.warn(
            `NFC-e ${nfce.numero} rejeitada: ${situacao?.SitDescricao}`,
          );
        }
      } else {
        // SEFAZ ainda indisponível para esta nota
        this.logger.debug(
          `NFC-e ${nfce.numero} ainda pendente de sincronização`,
        );
        await this.incrementSyncAttempts(nfce.id);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao sincronizar NFC-e ${nfce.numero}: ${error.message}`,
      );
      await this.incrementSyncAttempts(nfce.id);
    }
  }

  /**
   * Verifica disponibilidade da SEFAZ
   */
  private async checkSefazAvailability(companyId: string): Promise<boolean> {
    try {
      // Tenta uma consulta simples de status
      const result = await this.invoicyApiService.checkSefazStatus(companyId);
      return result.available;
    } catch {
      return false;
    }
  }

  /**
   * Agrupa NFC-e por empresa
   */
  private groupByCompany(nfces: any[]): Record<string, any[]> {
    return nfces.reduce(
      (acc, nfce) => {
        const companyId = nfce.companyId;
        if (!acc[companyId]) {
          acc[companyId] = [];
        }
        acc[companyId].push(nfce);
        return acc;
      },
      {} as Record<string, any[]>,
    );
  }

  /**
   * Marca NFC-e como autorizada
   */
  private async markAsAuthorized(nfceId: string, doc: any): Promise<void> {
    await this.prisma.nfce.update({
      where: { id: nfceId },
      data: {
        status: NfceStatus.AUTHORIZED,
        contingencia: false,
        chaveAcesso: doc.DocChaAcesso || null,
        protocolo: doc.DocProtocolo || null,
        invoicyId: doc.DocIDUnico || null,
        invoicyProtocol: doc.DocProtocolo || null,
        dataAutorizacao: new Date(),
        qrCodeUrl: doc.DocCompleto || null,
        danfeUrl: doc.DocPDFDownload || null,
        xmlAutorizado: doc.DocXMLBase64
          ? Buffer.from(doc.DocXMLBase64, 'base64').toString('utf-8')
          : null,
      },
    });
  }

  /**
   * Marca NFC-e como rejeitada
   */
  private async markAsRejected(nfceId: string, motivo: string): Promise<void> {
    await this.prisma.nfce.update({
      where: { id: nfceId },
      data: {
        status: NfceStatus.REJECTED,
        contingencia: false,
        motivoRejeicao: motivo,
      },
    });
  }

  /**
   * Marca NFC-e como expirada (não pode mais ser transmitida)
   */
  private async markAsExpired(nfceId: string): Promise<void> {
    await this.prisma.nfce.update({
      where: { id: nfceId },
      data: {
        status: NfceStatus.REJECTED,
        contingencia: false,
        motivoRejeicao:
          'Prazo de transmissão expirado (24h). NFC-e em contingência não sincronizada.',
      },
    });
  }

  /**
   * Incrementa contador de tentativas de sincronização
   * (Útil para monitoramento e decisões de retry)
   */
  private async incrementSyncAttempts(nfceId: string): Promise<void> {
    // Por ora, apenas atualiza updatedAt para tracking
    // Futuramente pode-se adicionar campo de tentativas
    await this.prisma.nfce.update({
      where: { id: nfceId },
      data: {
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Força sincronização de uma NFC-e específica (chamado manualmente)
   */
  async forceSyncNfce(
    companyId: string,
    nfceId: string,
  ): Promise<{ success: boolean; message: string }> {
    const nfce = await this.prisma.nfce.findFirst({
      where: {
        id: nfceId,
        companyId,
        status: NfceStatus.CONTINGENCY,
      },
    });

    if (!nfce) {
      return {
        success: false,
        message: 'NFC-e não encontrada ou não está em contingência',
      };
    }

    const config = await this.invoicyService.getConfig(companyId);
    if (!config) {
      return { success: false, message: 'Configuração Invoicy não encontrada' };
    }

    try {
      await this.syncSingleNfce(companyId, nfce);

      // Buscar status atualizado
      const updated = await this.prisma.nfce.findUnique({
        where: { id: nfceId },
      });

      if (updated?.status === NfceStatus.AUTHORIZED) {
        return {
          success: true,
          message: 'NFC-e sincronizada e autorizada com sucesso',
        };
      } else if (updated?.status === NfceStatus.REJECTED) {
        return {
          success: false,
          message: `NFC-e rejeitada: ${updated.motivoRejeicao}`,
        };
      } else {
        return {
          success: false,
          message: 'Sincronização ainda pendente, tente novamente mais tarde',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Erro ao sincronizar: ${error.message}`,
      };
    }
  }

  /**
   * Retorna estatísticas de NFC-e em contingência
   */
  async getContingencyStats(companyId?: string): Promise<{
    total: number;
    byCompany: Record<string, number>;
    oldest?: Date;
  }> {
    const where = companyId
      ? { companyId, status: NfceStatus.CONTINGENCY }
      : { status: NfceStatus.CONTINGENCY };

    const [total, grouped, oldest] = await Promise.all([
      this.prisma.nfce.count({ where }),
      this.prisma.nfce.groupBy({
        by: ['companyId'],
        where: { status: NfceStatus.CONTINGENCY },
        _count: true,
      }),
      this.prisma.nfce.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const byCompany = grouped.reduce(
      (acc, item) => {
        acc[item.companyId] = item._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      total,
      byCompany,
      oldest: oldest?.createdAt,
    };
  }
}

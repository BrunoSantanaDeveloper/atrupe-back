import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import {
  CreatePayableHistoryDto,
  CreateReceivableHistoryDto,
} from './dto/create-history.dto';

@Injectable()
export class FinancialHistoryService {
  private readonly logger = new Logger(FinancialHistoryService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de histórico para uma conta a receber
   */
  async createReceivableHistory(dto: CreateReceivableHistoryDto) {
    try {
      return await this.prisma.receivableHistory.create({
        data: {
          receivableId: dto.receivableId,
          action: dto.action,
          description: dto.description,
          changes: dto.changes || null,
          metadata: dto.metadata || null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName || null,
        },
      });
    } catch (error) {
      this.logger.error('Erro ao criar histórico de conta a receber', error.stack);
      // Não lançar erro para não quebrar a operação principal
      return null;
    }
  }

  /**
   * Cria um registro de histórico para uma conta a pagar
   */
  async createPayableHistory(dto: CreatePayableHistoryDto) {
    try {
      return await this.prisma.payableHistory.create({
        data: {
          payableId: dto.payableId,
          action: dto.action,
          description: dto.description,
          changes: dto.changes || null,
          metadata: dto.metadata || null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName || null,
        },
      });
    } catch (error) {
      this.logger.error('Erro ao criar histórico de conta a pagar', error.stack);
      // Não lançar erro para não quebrar a operação principal
      return null;
    }
  }

  /**
   * Busca o histórico completo de uma conta a receber
   */
  async getReceivableHistory(receivableId: string) {
    const history = await this.prisma.receivableHistory.findMany({
      where: { receivableId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      total: history.length,
      history: history.map((item) => ({
        id: item.id,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: item.metadata,
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name,
        createdAt: item.createdAt,
        user: item.user,
      })),
    };
  }

  /**
   * Busca o histórico completo de uma conta a pagar
   */
  async getPayableHistory(payableId: string) {
    const history = await this.prisma.payableHistory.findMany({
      where: { payableId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      total: history.length,
      history: history.map((item) => ({
        id: item.id,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: item.metadata,
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name,
        createdAt: item.createdAt,
        user: item.user,
      })),
    };
  }

  /**
   * Métodos auxiliares para formatar descrições padronizadas
   */
  getCreateDescription(): string {
    return 'Título criado';
  }

  getUpdateTitleDescription(changes: { after?: Record<string, unknown> | object }): string {
    const changedFields = Object.keys(changes.after || {});
    return `Título atualizado: ${changedFields.join(', ')}`;
  }

  getUpdateInstallmentsDescription(
    addedCount: number,
    modifiedCount: number,
    removedCount: number,
  ): string {
    const parts = [];
    if (addedCount > 0) parts.push(`${addedCount} adicionada(s)`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} modificada(s)`);
    if (removedCount > 0) parts.push(`${removedCount} removida(s)`);
    return `Parcelas alteradas: ${parts.join(', ')}`;
  }

  getPayInstallmentDescription(installmentNumber: number): string {
    return `Parcela ${installmentNumber} paga`;
  }

  getUndoPaymentDescription(installmentNumber: number): string {
    return `Pagamento da parcela ${installmentNumber} desfeito`;
  }

  getCancelDescription(reason?: string): string {
    return reason ? `Título cancelado: ${reason}` : 'Título cancelado';
  }

  getUndoCancelDescription(): string {
    return 'Cancelamento desfeito - título reativado';
  }
}

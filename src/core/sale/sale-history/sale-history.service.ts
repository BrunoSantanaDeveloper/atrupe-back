import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

interface UnifiedHistoryItem {
  id: string;
  type: 'quotation' | 'order' | 'receivable' | 'payable';
  entityId: string;
  action: string;
  description: string;
  changes: any;
  metadata: any;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  } | null;
}

@Injectable()
export class SaleHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Busca histórico unificado de todas as entidades relacionadas a uma venda (orçamento)
   * Inclui: histórico do orçamento, ordem de serviço, receitas e despesas
   */
  async getSaleHistory(quotationId: string, companyId: string) {
    // O orçamento precisa ser da empresa da sessão
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      include: {
        order: {
          select: { id: true },
        },
      },
    });

    if (!quotation) {
      throw new Error('Orçamento não encontrado');
    }

    // Buscar todos os históricos em paralelo
    const [quotationHistory, orderHistory, receivableHistory, payableHistory] =
      await Promise.all([
        // Histórico do orçamento
        this.prisma.quotationHistory.findMany({
          where: { quotationId },
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
        }),

        // Histórico da ordem (se existir)
        quotation.order
          ? this.prisma.orderHistory.findMany({
              where: { orderId: quotation.order.id },
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
            })
          : Promise.resolve([]),

        // Histórico de receitas relacionadas ao orçamento
        this.prisma.receivableHistory.findMany({
          where: {
            receivable: {
              quotationId,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
            receivable: {
              select: {
                id: true,
                description: true,
              },
            },
          },
        }),

        // Histórico de despesas relacionadas ao orçamento
        this.prisma.payableHistory.findMany({
          where: {
            payable: {
              quotationId,
            },
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
            payable: {
              select: {
                id: true,
                description: true,
              },
            },
          },
        }),
      ]);

    // Unificar e normalizar todos os históricos
    const unifiedHistory: UnifiedHistoryItem[] = [
      // Histórico do orçamento
      ...quotationHistory.map((item) => ({
        id: item.id,
        type: 'quotation' as const,
        entityId: item.quotationId,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: item.metadata,
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name || null,
        createdAt: item.createdAt,
        user: item.user,
      })),

      // Histórico da ordem
      ...orderHistory.map((item) => ({
        id: item.id,
        type: 'order' as const,
        entityId: item.orderId,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: item.metadata,
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name || null,
        createdAt: item.createdAt,
        user: item.user,
      })),

      // Histórico de receitas
      ...receivableHistory.map((item: any) => ({
        id: item.id,
        type: 'receivable' as const,
        entityId: item.receivableId,
        action: item.action,
        description: `[Receita] ${item.description}`,
        changes: item.changes,
        metadata: {
          ...item.metadata,
          receivableDescription: item.receivable?.description,
        },
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name || null,
        createdAt: item.createdAt,
        user: item.user,
      })),

      // Histórico de despesas
      ...payableHistory.map((item: any) => ({
        id: item.id,
        type: 'payable' as const,
        entityId: item.payableId,
        action: item.action,
        description: `[Despesa] ${item.description}`,
        changes: item.changes,
        metadata: {
          ...item.metadata,
          payableDescription: item.payable?.description,
        },
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name || null,
        createdAt: item.createdAt,
        user: item.user,
      })),
    ];

    // Ordenar por data (mais recente primeiro)
    unifiedHistory.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    return {
      total: unifiedHistory.length,
      quotationId,
      orderId: quotation.order?.id || null,
      history: unifiedHistory,
    };
  }

  /**
   * Busca histórico unificado pelo ID da ordem de serviço
   */
  async getSaleHistoryByOrderId(orderId: string, companyId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, quotation: { companyId } },
      select: { quotationId: true },
    });

    if (!order) {
      throw new Error('Ordem de serviço não encontrada');
    }

    return this.getSaleHistory(order.quotationId, companyId);
  }
}

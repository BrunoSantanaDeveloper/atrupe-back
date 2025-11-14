import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateOrderHistoryDto } from './dto/create-order-history.dto';

@Injectable()
export class OrderHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de histórico para uma ordem de serviço
   */
  async createOrderHistory(dto: CreateOrderHistoryDto) {
    try {
      return await this.prisma.orderHistory.create({
        data: {
          orderId: dto.orderId,
          action: dto.action,
          description: dto.description,
          changes: dto.changes || null,
          metadata: dto.metadata || null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName || null,
        },
      });
    } catch (error) {
      console.error('Error creating order history:', error);
      // Não lançar erro para não quebrar a operação principal
      return null;
    }
  }

  /**
   * Busca o histórico completo de uma ordem de serviço
   */
  async getOrderHistory(orderId: string) {
    const history = await this.prisma.orderHistory.findMany({
      where: { orderId },
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
  getCreateDescription(approvedBy?: string): string {
    return approvedBy
      ? `Ordem de serviço criada - Orçamento aprovado por ${approvedBy}`
      : 'Ordem de serviço criada - Orçamento aprovado';
  }

  getCancelDescription(reason?: string): string {
    return reason
      ? `Ordem de serviço cancelada: ${reason}`
      : 'Ordem de serviço cancelada';
  }
}

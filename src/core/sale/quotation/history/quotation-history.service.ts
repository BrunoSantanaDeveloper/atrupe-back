import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateQuotationHistoryDto } from './dto/create-quotation-history.dto';

@Injectable()
export class QuotationHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de histórico para um orçamento
   */
  async createQuotationHistory(dto: CreateQuotationHistoryDto) {
    try {
      return await this.prisma.quotationHistory.create({
        data: {
          quotationId: dto.quotationId,
          action: dto.action,
          description: dto.description,
          changes: dto.changes || null,
          metadata: dto.metadata || null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName || null,
        },
      });
    } catch (error) {
      console.error('Error creating quotation history:', error);
      // Não lançar erro para não quebrar a operação principal
      return null;
    }
  }

  /**
   * Busca o histórico completo de um orçamento
   */
  async getQuotationHistory(quotationId: string) {
    const history = await this.prisma.quotationHistory.findMany({
      where: { quotationId },
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
    return 'Orçamento criado';
  }

  getFinishDescription(): string {
    return 'Orçamento concluído';
  }

  getReopenDescription(): string {
    return 'Orçamento reaberto';
  }

  getRejectDescription(reason?: string): string {
    return reason ? `Orçamento rejeitado: ${reason}` : 'Orçamento rejeitado';
  }

  getApprovedDescription(approvedBy?: string): string {
    return approvedBy
      ? `Orçamento aprovado por ${approvedBy}`
      : 'Orçamento aprovado';
  }

  getValueChangeDescription(changes: any): string {
    const productName = changes.productName || 'Item';
    const field = changes.field || 'valor';
    return `${productName}: ${field} alterado manualmente`;
  }

  getProductValueChangeDescription(
    productName: string,
    oldValue: number,
    newValue: number,
  ): string {
    return `${productName}: valor alterado de R$ ${oldValue.toFixed(2)} para R$ ${newValue.toFixed(2)}`;
  }

  getItemQuantityChangeDescription(
    itemName: string,
    oldQuantity: number,
    newQuantity: number,
  ): string {
    return `${itemName}: quantidade alterada de ${oldQuantity} para ${newQuantity}`;
  }
}

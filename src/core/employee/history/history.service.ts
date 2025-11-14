import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { CreateEmployeeHistoryDto } from './dto/create-history.dto';

@Injectable()
export class EmployeeHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de histórico para um colaborador
   */
  async createEmployeeHistory(dto: CreateEmployeeHistoryDto) {
    try {
      return await this.prisma.employeeHistory.create({
        data: {
          employeeId: dto.employeeId,
          action: dto.action,
          description: dto.description,
          changes: dto.changes || null,
          metadata: dto.metadata || null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName || null,
        },
      });
    } catch (error) {
      console.error('Error creating employee history:', error);
      // Não lançar erro para não quebrar a operação principal
      return null;
    }
  }

  /**
   * Busca o histórico completo de um colaborador
   */
  async getEmployeeHistory(employeeId: string) {
    // Buscar o userId associado ao employee
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (!employee) {
      return {
        total: 0,
        history: [],
      };
    }

    // Buscar histórico de ações do colaborador
    const employeeHistory = await this.prisma.employeeHistory.findMany({
      where: { employeeId },
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

    // Preparar array unificado de histórico
    let allHistory: any[] = employeeHistory.map((item) => ({
      id: item.id,
      type: 'EMPLOYEE' as const,
      action: item.action,
      description: item.description,
      changes: item.changes,
      metadata: item.metadata,
      createdBy: item.createdBy,
      createdByName: item.createdByName || item.user?.name,
      createdAt: item.createdAt,
      user: item.user,
    }));

    // Se o colaborador tem um usuário associado, buscar históricos de quotation e order
    if (employee.userId) {
      const [quotationHistories, orderHistories] = await Promise.all([
        // Histórico de orçamentos onde o usuário é o autor
        this.prisma.quotationHistory.findMany({
          where: { createdBy: employee.userId },
          orderBy: { createdAt: 'desc' },
          include: {
            quotation: {
              select: {
                id: true,
                quotationNumber: true,
                description: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
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
        // Histórico de ordens de serviço onde o usuário é o autor
        this.prisma.orderHistory.findMany({
          where: { createdBy: employee.userId },
          orderBy: { createdAt: 'desc' },
          include: {
            order: {
              select: {
                id: true,
                quotation: {
                  select: {
                    id: true,
                    quotationNumber: true,
                    description: true,
                    client: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
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
      ]);

      // Adicionar históricos de orçamentos
      const quotationHistoryMapped = quotationHistories.map((item) => ({
        id: item.id,
        type: 'QUOTATION' as const,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: {
          ...((item.metadata as object) || {}),
          quotationId: item.quotation.id,
          quotationNumber: item.quotation.quotationNumber,
          quotationDescription: item.quotation.description,
          clientName: item.quotation.client?.name,
        },
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name,
        createdAt: item.createdAt,
        user: item.user,
      }));

      // Adicionar históricos de ordens de serviço
      const orderHistoryMapped = orderHistories.map((item) => ({
        id: item.id,
        type: 'ORDER' as const,
        action: item.action,
        description: item.description,
        changes: item.changes,
        metadata: {
          ...((item.metadata as object) || {}),
          orderId: item.order.id,
          quotationId: item.order.quotation.id,
          quotationNumber: item.order.quotation.quotationNumber,
          quotationDescription: item.order.quotation.description,
          clientName: item.order.quotation.client?.name,
        },
        createdBy: item.createdBy,
        createdByName: item.createdByName || item.user?.name,
        createdAt: item.createdAt,
        user: item.user,
      }));

      // Unificar todos os históricos
      allHistory = [
        ...allHistory,
        ...quotationHistoryMapped,
        ...orderHistoryMapped,
      ];
    }

    // Ordenar por data (mais recente primeiro)
    allHistory.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      total: allHistory.length,
      history: allHistory,
    };
  }

  /**
   * Métodos auxiliares para formatar descrições padronizadas
   */
  getCreateDescription(name: string): string {
    return `Colaborador ${name} criado`;
  }

  getUpdateDescription(changedFields: string[]): string {
    if (changedFields.length === 0) return 'Colaborador atualizado';
    return `Campos alterados: ${changedFields.join(', ')}`;
  }

  getDeactivateDescription(name: string): string {
    return `Colaborador ${name} desativado`;
  }

  getReactivateDescription(name: string): string {
    return `Colaborador ${name} reativado`;
  }
}

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
    const history = await this.prisma.employeeHistory.findMany({
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

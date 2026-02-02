import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';

/**
 * Service responsável pelo registro e consulta de histórico de alterações em empresas.
 * Extraído de CompanyService para seguir Single Responsibility Principle.
 */
@Injectable()
export class CompanyHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria um registro de histórico para uma empresa.
   */
  async createHistory(
    companyId: string,
    action: string,
    description: string,
    changes?: { before?: any; after?: any },
    metadata?: Record<string, any>,
    userId?: string,
    userName?: string,
  ) {
    return await this.prisma.companyHistory.create({
      data: {
        companyId,
        action,
        description,
        changes: changes || undefined,
        metadata: metadata || undefined,
        createdBy: userId || null,
        createdByName: userName || null,
      },
    });
  }

  /**
   * Lista o histórico de alterações de uma empresa com paginação.
   */
  async listHistory(companyId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      this.prisma.companyHistory.findMany({
        where: { companyId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.companyHistory.count({
        where: { companyId },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: history,
      meta: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }
}

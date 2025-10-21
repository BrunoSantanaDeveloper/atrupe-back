import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ActivityMonitorService {
  constructor(private prisma: PrismaService) {}

  /**
   * Registra ou atualiza a atividade do usuário
   */
  async trackActivity(data: {
    userId: string;
    companyId?: string;
    employeeId?: string;
    sessionId?: string;
    endpoint?: string;
    method?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const { userId, sessionId, ...activityData } = data;

    if (!sessionId) {
      // Se não houver sessionId, criar nova sessão
      await this.prisma.userActivity.create({
        data: {
          userId,
          sessionId: uuidv4(),
          ...activityData,
        },
      });
      return;
    }

    // Atualizar a atividade existente ou criar nova
    const existingActivity = await this.prisma.userActivity.findFirst({
      where: {
        sessionId,
        userId,
        isActive: true,
      },
    });

    if (existingActivity) {
      await this.prisma.userActivity.update({
        where: { id: existingActivity.id },
        data: {
          lastActive: new Date(),
          endpoint: activityData.endpoint,
          method: activityData.method,
          ipAddress: activityData.ipAddress,
          userAgent: activityData.userAgent,
        },
      });
    } else {
      await this.prisma.userActivity.create({
        data: {
          userId,
          sessionId,
          ...activityData,
        },
      });
    }
  }

  /**
   * Registra o logout do usuário
   */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.userActivity.updateMany({
      where: {
        sessionId,
        isActive: true,
      },
      data: {
        isActive: false,
        logoutAt: new Date(),
      },
    });
  }

  /**
   * Obtém usuários atualmente online (ativos nos últimos X minutos)
   */
  async getOnlineUsers(companyId?: string, minutesThreshold = 5) {
    const thresholdDate = new Date(Date.now() - minutesThreshold * 60 * 1000);

    const whereClause: any = {
      isActive: true,
      lastActive: {
        gte: thresholdDate,
      },
    };

    if (companyId) {
      whereClause.companyId = companyId;
    }

    const activities = await this.prisma.userActivity.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            employee: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                company: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        lastActive: 'desc',
      },
    });

    // Agrupar por usuário (pode ter múltiplas sessões)
    const userMap = new Map();

    activities.forEach((activity) => {
      if (!userMap.has(activity.userId)) {
        userMap.set(activity.userId, {
          userId: activity.userId,
          userName: activity.user.employee[0]?.name || activity.user.name,
          email: activity.user.email,
          avatar: activity.user.employee[0]?.avatarUrl || activity.user.avatar,
          companyId: activity.companyId,
          companyName: activity.user.employee[0]?.company?.name,
          lastActive: activity.lastActive,
          sessions: [],
        });
      }

      const userData = userMap.get(activity.userId);
      userData.sessions.push({
        sessionId: activity.sessionId,
        lastActive: activity.lastActive,
        ipAddress: activity.ipAddress,
        endpoint: activity.endpoint,
      });

      // Atualizar lastActive com a mais recente
      if (activity.lastActive > userData.lastActive) {
        userData.lastActive = activity.lastActive;
      }
    });

    return Array.from(userMap.values());
  }

  /**
   * Obtém última atividade de um usuário específico
   */
  async getUserLastActivity(userId: string) {
    const lastActivity = await this.prisma.userActivity.findFirst({
      where: { userId },
      orderBy: { lastActive: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            employee: {
              select: {
                name: true,
                company: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return lastActivity;
  }

  /**
   * Obtém histórico de atividades de um usuário
   */
  async getUserActivityHistory(userId: string, limit = 50, offset = 0) {
    const activities = await this.prisma.userActivity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await this.prisma.userActivity.count({
      where: { userId },
    });

    return {
      data: activities,
      total,
      limit,
      offset,
    };
  }

  /**
   * Obtém estatísticas de uso por empresa
   */
  async getCompanyStatistics(companyId: string, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const activities = await this.prisma.userActivity.findMany({
      where: {
        companyId,
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        userId: true,
        createdAt: true,
        lastActive: true,
      },
    });

    const uniqueUsers = new Set(activities.map((a) => a.userId));
    const totalSessions = activities.length;

    // Usuários ativos hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = new Set(
      activities.filter((a) => a.lastActive >= today).map((a) => a.userId),
    );

    return {
      totalUsers: uniqueUsers.size,
      totalSessions,
      activeToday: activeToday.size,
      periodDays: days,
    };
  }

  /**
   * Limpa sessões inativas (mais de X dias sem atividade)
   */
  async cleanInactiveSessions(daysInactive = 30): Promise<number> {
    const thresholdDate = new Date(
      Date.now() - daysInactive * 24 * 60 * 60 * 1000,
    );

    const result = await this.prisma.userActivity.updateMany({
      where: {
        isActive: true,
        lastActive: {
          lt: thresholdDate,
        },
      },
      data: {
        isActive: false,
        logoutAt: new Date(),
      },
    });

    return result.count;
  }

  /**
   * Deleta registros antigos de atividades (limpeza de dados)
   */
  async deleteOldActivities(daysToKeep = 90): Promise<number> {
    const thresholdDate = new Date(
      Date.now() - daysToKeep * 24 * 60 * 60 * 1000,
    );

    const result = await this.prisma.userActivity.deleteMany({
      where: {
        createdAt: {
          lt: thresholdDate,
        },
        isActive: false,
      },
    });

    return result.count;
  }

  /**
   * Gera um novo sessionId
   */
  generateSessionId(): string {
    return uuidv4();
  }
}

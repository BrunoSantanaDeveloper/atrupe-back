import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

type AccessStatus = 'active' | 'inactive';

@Injectable()
export class ActivityMonitorService {
  constructor(private prisma: PrismaService) {}

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
    const resolvedSessionId = sessionId || uuidv4();

    const existingActivity = await this.prisma.userActivity.findFirst({
      where: {
        sessionId: resolvedSessionId,
        userId,
        isActive: true,
      },
    });

    let activityId: string;

    if (existingActivity) {
      const updatedActivity = await this.prisma.userActivity.update({
        where: { id: existingActivity.id },
        data: {
          lastActive: new Date(),
          endpoint: activityData.endpoint,
          method: activityData.method,
          ipAddress: activityData.ipAddress,
          userAgent: activityData.userAgent,
        },
      });
      activityId = updatedActivity.id;
    } else {
      const createdActivity = await this.prisma.userActivity.create({
        data: {
          userId,
          sessionId: resolvedSessionId,
          ...activityData,
        },
      });
      activityId = createdActivity.id;
    }

    const userActivityEvent = (this.prisma as any).userActivityEvent;
    if (userActivityEvent) {
      await userActivityEvent.create({
        data: {
          activityId,
          userId,
          sessionId: resolvedSessionId,
          ...activityData,
        },
      });
    }
  }

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

      if (activity.lastActive > userData.lastActive) {
        userData.lastActive = activity.lastActive;
      }
    });

    return Array.from(userMap.values());
  }

  async getUserLastActivity(userId: string) {
    return this.prisma.userActivity.findFirst({
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
  }

  async getUserActivityHistory(userId: string, limit = 50, offset = 0) {
    const activities = await this.prisma.userActivity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        events: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
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

  async listAccessSessions(filters: {
    page?: number;
    limit?: number;
    search?: string;
    companyId?: string;
    userId?: string;
    method?: string;
    status?: AccessStatus;
    startDate?: Date;
    endDate?: Date;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (filters.companyId) where.companyId = filters.companyId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.method) where.method = filters.method;
    if (filters.status) where.isActive = filters.status === 'active';
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }
    if (filters.search) {
      where.OR = [
        { sessionId: { contains: filters.search, mode: 'insensitive' } },
        { endpoint: { contains: filters.search, mode: 'insensitive' } },
        { user: { name: { contains: filters.search, mode: 'insensitive' } } },
        { user: { email: { contains: filters.search, mode: 'insensitive' } } },
        {
          user: {
            employee: {
              some: {
                company: {
                  name: { contains: filters.search, mode: 'insensitive' },
                },
              },
            },
          },
        },
      ];
    }

    const [sessions, total] = await Promise.all([
      this.prisma.userActivity.findMany({
        where,
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
          _count: {
            select: { events: true },
          },
        },
        orderBy: { lastActive: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.userActivity.count({ where }),
    ]);

    return {
      data: sessions.map((activity) => ({
        id: activity.id,
        userId: activity.userId,
        userName: activity.user.employee[0]?.name || activity.user.name,
        email: activity.user.email,
        avatar: activity.user.employee[0]?.avatarUrl || activity.user.avatar,
        companyId: activity.companyId,
        companyName: activity.user.employee[0]?.company?.name,
        employeeId: activity.employeeId,
        sessionId: activity.sessionId,
        endpoint: activity.endpoint,
        method: activity.method,
        ipAddress: activity.ipAddress,
        userAgent: activity.userAgent,
        createdAt: activity.createdAt,
        lastActive: activity.lastActive,
        isActive: activity.isActive,
        logoutAt: activity.logoutAt,
        eventsCount: (activity as any)._count?.events || 0,
      })),
      total,
      page,
      limit,
      lastPage: Math.ceil(total / limit) || 1,
    };
  }

  async getAccessSummary(companyId?: string, days = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: any = { createdAt: { gte: startDate } };
    if (companyId) where.companyId = companyId;

    const userActivityEvent = (this.prisma as any).userActivityEvent;
    const [totalSessions, activeSessions, users, companies, totalEvents] =
      await Promise.all([
        this.prisma.userActivity.count({ where }),
        this.prisma.userActivity.count({
          where: { ...where, isActive: true },
        }),
        this.prisma.userActivity.findMany({
          where,
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.userActivity.findMany({
          where: { ...where, companyId: { not: null } },
          select: { companyId: true },
          distinct: ['companyId'],
        }),
        userActivityEvent ? userActivityEvent.count({ where }) : 0,
      ]);

    return {
      totalSessions,
      activeSessions,
      uniqueUsers: users.length,
      uniqueCompanies: companies.length,
      totalEvents,
      periodDays: days,
    };
  }

  async getSessionDetails(sessionId: string, limit = 50, offset = 0) {
    const activity = await this.prisma.userActivity.findFirst({
      where: { sessionId },
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
                company: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { lastActive: 'desc' },
    });

    if (!activity) return null;

    const userActivityEvent = (this.prisma as any).userActivityEvent;
    const [events, total] = userActivityEvent
      ? await Promise.all([
          userActivityEvent.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
          }),
          userActivityEvent.count({ where: { sessionId } }),
        ])
      : [[], 0];

    return {
      session: {
        id: activity.id,
        userId: activity.userId,
        userName: activity.user.employee[0]?.name || activity.user.name,
        email: activity.user.email,
        avatar: activity.user.employee[0]?.avatarUrl || activity.user.avatar,
        companyId: activity.companyId,
        companyName: activity.user.employee[0]?.company?.name,
        employeeId: activity.employeeId,
        sessionId: activity.sessionId,
        endpoint: activity.endpoint,
        method: activity.method,
        ipAddress: activity.ipAddress,
        userAgent: activity.userAgent,
        createdAt: activity.createdAt,
        lastActive: activity.lastActive,
        isActive: activity.isActive,
        logoutAt: activity.logoutAt,
      },
      events: {
        data: events,
        total,
        limit,
        offset,
      },
    };
  }

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

  async deleteOldActivities(daysToKeep = 90): Promise<number> {
    const thresholdDate = new Date(
      Date.now() - daysToKeep * 24 * 60 * 60 * 1000,
    );

    const userActivityEvent = (this.prisma as any).userActivityEvent;
    if (userActivityEvent) {
      await userActivityEvent.deleteMany({
        where: {
          createdAt: {
            lt: thresholdDate,
          },
        },
      });
    }

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

  generateSessionId(): string {
    return uuidv4();
  }
}

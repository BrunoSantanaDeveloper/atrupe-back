import { ActivityMonitorService } from './activity-monitor.service';

describe('ActivityMonitorService', () => {
  let service: ActivityMonitorService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userActivity: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      userActivityEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    service = new ActivityMonitorService(prisma);
  });

  it('updates the session summary and creates a detailed event', async () => {
    prisma.userActivity.findFirst.mockResolvedValue({ id: 'activity-1' });
    prisma.userActivity.update.mockResolvedValue({ id: 'activity-1' });

    await service.trackActivity({
      userId: 'user-1',
      companyId: 'company-1',
      sessionId: 'session-1',
      endpoint: '/clients',
      method: 'GET',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(prisma.userActivity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activity-1' },
        data: expect.objectContaining({ endpoint: '/clients' }),
      }),
    );
    expect(prisma.userActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activityId: 'activity-1',
        userId: 'user-1',
        sessionId: 'session-1',
        method: 'GET',
      }),
    });
  });

  it('creates a session summary when the session is new', async () => {
    prisma.userActivity.findFirst.mockResolvedValue(null);
    prisma.userActivity.create.mockResolvedValue({ id: 'activity-2' });

    await service.trackActivity({
      userId: 'user-1',
      sessionId: 'session-2',
      endpoint: '/orders',
      method: 'POST',
    });

    expect(prisma.userActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-2',
      }),
    });
    expect(prisma.userActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activityId: 'activity-2',
        endpoint: '/orders',
      }),
    });
  });

  it('lists access sessions with pagination metadata', async () => {
    prisma.userActivity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        userId: 'user-1',
        companyId: 'company-1',
        employeeId: 'employee-1',
        sessionId: 'session-1',
        endpoint: '/dashboard',
        method: 'GET',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        lastActive: new Date('2026-05-12T10:05:00.000Z'),
        isActive: true,
        logoutAt: null,
        user: {
          name: 'User',
          email: 'user@test.com',
          avatar: null,
          employee: [
            {
              name: 'Employee',
              avatarUrl: null,
              company: { name: 'Company' },
            },
          ],
        },
        _count: { events: 3 },
      },
    ]);
    prisma.userActivity.count.mockResolvedValue(1);

    const result = await service.listAccessSessions({
      page: 1,
      limit: 10,
      status: 'active',
    });

    expect(result.total).toBe(1);
    expect(result.lastPage).toBe(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        userName: 'Employee',
        companyName: 'Company',
        eventsCount: 3,
      }),
    );
  });

  it('returns session details with detailed events', async () => {
    prisma.userActivity.findFirst.mockResolvedValue({
      id: 'activity-1',
      userId: 'user-1',
      companyId: 'company-1',
      employeeId: 'employee-1',
      sessionId: 'session-1',
      endpoint: '/dashboard',
      method: 'GET',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      lastActive: new Date('2026-05-12T10:05:00.000Z'),
      isActive: false,
      logoutAt: new Date('2026-05-12T11:00:00.000Z'),
      user: {
        name: 'User',
        email: 'user@test.com',
        avatar: null,
        employee: [],
      },
    });
    prisma.userActivityEvent.findMany.mockResolvedValue([{ id: 'event-1' }]);
    prisma.userActivityEvent.count.mockResolvedValue(1);

    const result = await service.getSessionDetails('session-1');

    expect(result?.session.sessionId).toBe('session-1');
    expect(result?.events.total).toBe(1);
  });
});

import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ActivityMonitorController } from './activity-monitor.controller';
import { SystemAdminGuard } from '../auth/guards/system-admin.guard';

describe('ActivityMonitorController', () => {
  let controller: ActivityMonitorController;
  let service: any;

  beforeEach(() => {
    service = {
      getOnlineUsers: jest.fn(),
      listAccessSessions: jest.fn(),
      getAccessSummary: jest.fn(),
      getSessionDetails: jest.fn(),
      getUserLastActivity: jest.fn(),
      getUserActivityHistory: jest.fn(),
      getCompanyStatistics: jest.fn(),
      logout: jest.fn(),
    };
    controller = new ActivityMonitorController(service);
  });

  it('passes filters to access session listing', async () => {
    service.listAccessSessions.mockResolvedValue({ data: [], total: 0 });

    await controller.listAccessSessions({
      page: 2,
      limit: 20,
      search: 'company',
      method: 'GET',
      status: 'active',
      startDate: '2026-05-01',
      endDate: '2026-05-12',
    });

    expect(service.listAccessSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 20,
        search: 'company',
        method: 'GET',
        status: 'active',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-12'),
      }),
    );
  });

  it('protects detailed admin endpoints with the system admin guard', () => {
    const guards =
      Reflect.getMetadata(
        GUARDS_METADATA,
        ActivityMonitorController.prototype.listAccessSessions,
      ) || [];

    expect(guards).toContain(SystemAdminGuard);
  });

  it('throws not found when session details are missing', async () => {
    service.getSessionDetails.mockResolvedValue(null);

    await expect(
      controller.getSessionDetails('missing-session'),
    ).rejects.toThrow(NotFoundException);
  });
});

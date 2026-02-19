import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;

  const mockPrismaService = {
    mailVerification: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    subscription: {
      findMany: jest.fn(),
    },
    company: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userActivity: {
      findFirst: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AdminDashboardService>(AdminDashboardService);
    jest.resetAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── listIncompleteRegistrations ───────────────────────────────────────

  describe('listIncompleteRegistrations', () => {
    it('should return paginated results grouped by date', async () => {
      const mockVerifications = [
        {
          id: 'abcd1234-test',
          companyName: 'Test Co',
          name: 'John',
          phone: '11999999999',
          email: 'john@test.com',
          createdAt: new Date('2026-01-15T10:00:00Z'),
          verified: true,
        },
      ];
      mockPrismaService.mailVerification.findMany.mockResolvedValue(
        mockVerifications,
      );
      mockPrismaService.mailVerification.count.mockResolvedValue(1);

      const result = await service.listIncompleteRegistrations(1, 10);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toBe('2026-01-15');
      expect(result.data[0].data[0].code).toBe('ABCD');
    });

    it('should return empty when no registrations', async () => {
      mockPrismaService.mailVerification.findMany.mockResolvedValue([]);
      mockPrismaService.mailVerification.count.mockResolvedValue(0);

      const result = await service.listIncompleteRegistrations();

      expect(result.total).toBe(0);
      expect(result.data).toHaveLength(0);
    });

    it('should apply search filter', async () => {
      mockPrismaService.mailVerification.findMany.mockResolvedValue([]);
      mockPrismaService.mailVerification.count.mockResolvedValue(0);

      await service.listIncompleteRegistrations(1, 10, 'name', 'test');

      expect(mockPrismaService.mailVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });
  });

  // ─── getTrialTotals ────────────────────────────────────────────────────

  describe('getTrialTotals', () => {
    it('should return correct trial counts', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const past = new Date();
      past.setDate(past.getDate() - 3);

      // Active trials
      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce([
          // ACTIVE trials
          { id: 'sub-1', companyId: 'c1', nextDueDate: future }, // ativa
          { id: 'sub-2', companyId: 'c2', nextDueDate: past }, // inativa (vencida)
        ])
        .mockResolvedValueOnce([
          // INACTIVE trials
          { id: 'sub-3', companyId: 'c3' },
        ])
        .mockResolvedValueOnce([]); // Companies with active sub (for discarded check)

      const result = await service.getTrialTotals();

      expect(result.data.ACTIVE).toBe(1);
      expect(result.data.INACTIVE).toBe(1);
      expect(result.data.DISCARDED).toBe(1);
      expect(result.data.TOTAL).toBe(3);
    });
  });

  // ─── getActiveTotals ──────────────────────────────────────────────────

  describe('getActiveTotals', () => {
    it('should return all status counts', async () => {
      mockPrismaService.company.count
        .mockResolvedValueOnce(10) // active
        .mockResolvedValueOnce(2) // blocked
        .mockResolvedValueOnce(3) // inactive
        .mockResolvedValueOnce(1); // canceled

      const result = await service.getActiveTotals();

      expect(result.data).toEqual({
        ACTIVE: 10,
        BLOCKED: 2,
        INACTIVE: 3,
        CANCELED: 1,
        TOTAL: 16,
      });
    });
  });

  // ─── getCompanyHistory ─────────────────────────────────────────────────

  describe('getCompanyHistory', () => {
    it('should throw NotFoundException when company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(service.getCompanyHistory('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return history with merged subscription and payment events', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        isActive: true,
        Subscription: [
          {
            plan: { name: 'START' },
            history: [
              {
                id: 'h1',
                action: 'CREATED',
                description: 'Sub created',
                createdAt: new Date('2026-01-10'),
                metadata: {},
              },
            ],
            payments: [
              {
                id: 'p1',
                status: 'RECEIVED',
                asaasPaymentId: 'pay_1',
                value: 99,
                billingType: 'CREDIT_CARD',
                dueDate: new Date('2026-01-15'),
                confirmedDate: new Date('2026-01-15'),
                paymentDate: new Date('2026-01-15'),
                invoiceUrl: 'https://invoice.url',
                createdAt: new Date('2026-01-15'),
              },
            ],
          },
        ],
      });
      mockPrismaService.userActivity.findFirst.mockResolvedValue({
        lastActive: new Date(),
        user: { name: 'Admin', email: 'admin@test.com' },
        ipAddress: '127.0.0.1',
      });

      const result = await service.getCompanyHistory('company-1');

      expect(result.data).toHaveLength(2); // 1 history + 1 payment
      // Sorted by date desc — payment (Jan 15) comes before history (Jan 10)
      expect(result.data[0].action).toBe('PAYMENT_RECEIVED');
      expect(result.data[1].action).toBe('CREATED');
      expect(result.lastAccess).toBeDefined();
      expect(result.company.name).toBe('Test');
    });

    it('should return null lastAccess when no activity found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Test',
        isActive: true,
        Subscription: [],
      });
      mockPrismaService.userActivity.findFirst.mockResolvedValue(null);

      const result = await service.getCompanyHistory('company-1');

      expect(result.lastAccess).toBeNull();
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── listActiveClients ─────────────────────────────────────────────────

  describe('listActiveClients', () => {
    it('should return paginated clients grouped by date', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Test Co',
          legalName: 'Test Co LTDA',
          cnpj: '12345678901234',
          email: 'test@co.com',
          phone: '11999999999',
          mobile: null,
          favIconUrl: null,
          blockLevel: 'NONE',
          Subscription: [
            {
              id: 'sub-1',
              createdAt: new Date('2026-01-15'),
              nextDueDate: new Date('2026-02-15'),
              status: 'ACTIVE',
              plan: { name: 'START', planType: 'START' },
            },
          ],
          address: [{ state: 'SP', city: 'São Paulo' }],
        },
      ]);
      mockPrismaService.company.count.mockResolvedValue(1);
      mockPrismaService.employee.findFirst.mockResolvedValue({
        cpf: '12345678901',
        user: { name: 'John', phone: '11999999999', email: 'john@test.com' },
      });

      const result = await service.listActiveClients(1, 10);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].data[0].status).toBe('ACTIVE');
      expect(result.data[0].data[0].plan).toBe('START');
    });

    it('should apply status filter for blocked companies', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([]);
      mockPrismaService.company.count.mockResolvedValue(0);

      await service.listActiveClients(1, 10, 'bloqueadas');

      expect(mockPrismaService.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            blockLevel: 'PARTIAL',
          }),
        }),
      );
    });
  });

  // ─── listTrialCompanies ────────────────────────────────────────────────

  describe('listTrialCompanies', () => {
    it('should return trial companies with correct status categorization', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      mockPrismaService.subscription.findMany
        .mockResolvedValueOnce([
          // All trial subs
          {
            id: 'sub-1',
            companyId: 'c1',
            status: 'ACTIVE',
            nextDueDate: future,
            createdAt: new Date('2026-01-10'),
            Company: {
              id: 'c1',
              name: 'Active Trial',
              legalName: 'Active Trial LTDA',
              cnpj: '111',
              email: 'a@t.com',
              phone: '111',
              mobile: null,
              favIconUrl: null,
              address: [],
            },
            plan: { name: 'TRIAL', planType: 'TRIAL' },
            customer: { name: 'C1' },
          },
        ])
        .mockResolvedValueOnce([]); // No active subs for inactive check

      mockPrismaService.employee.findFirst.mockResolvedValue(null);

      const result = await service.listTrialCompanies(1, 10);

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should filter by status "ativas" excluding expired trials', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);

      const allTrialData = [
        {
          id: 'sub-1',
          companyId: 'c1',
          status: 'ACTIVE' as const,
          nextDueDate: future,
          createdAt: new Date(),
          Company: { id: 'c1', name: 'Active Trial', address: [] },
          plan: { name: 'TRIAL', planType: 'TRIAL' },
          customer: {},
        },
      ];

      mockPrismaService.subscription.findMany.mockResolvedValue(allTrialData);
      mockPrismaService.employee.findFirst.mockResolvedValue(null);

      const result = await service.listTrialCompanies(1, 10, 'ativas');

      expect(result.total).toBe(1);
    });
  });
});

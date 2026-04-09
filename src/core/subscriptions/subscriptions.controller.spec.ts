import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';
import { SubscriptionBlockService } from './subscription-block.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        {
          provide: SubscriptionsService,
          useValue: {
            createSubscription: jest.fn(),
            getSubscription: jest.fn(),
          },
        },
        {
          provide: AdminDashboardService,
          useValue: {
            listActiveClients: jest.fn(),
            getDashboardSummary: jest.fn(),
          },
        },
        {
          provide: CompanyManagementService,
          useValue: {
            getCompanyDetails: jest.fn(),
            updatePlan: jest.fn(),
          },
        },
        {
          provide: SubscriptionBlockService,
          useValue: {
            checkAndApplyBlocks: jest.fn(),
            manualUnblock: jest.fn(),
            getBlockStatus: jest.fn(),
            listBlockedCompanies: jest.fn(),
            getPendingPaymentUrl: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            idempotencyKey: { findUnique: jest.fn(), create: jest.fn() },
          },
        },
      ],
    }).compile();

    controller = module.get<SubscriptionsController>(SubscriptionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

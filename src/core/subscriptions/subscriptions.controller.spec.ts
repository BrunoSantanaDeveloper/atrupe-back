import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';
import { SubscriptionBlockService } from './subscription-block.service';
import { SubscriptionQuoteService } from './pricing/subscription-quote.service';
import { ComplementsService } from './checkout/complements.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { GoneException } from '@nestjs/common';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  const complements = {
    legacyAddModule: jest.fn(),
    removeModule: jest.fn(),
  };

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
          provide: SubscriptionQuoteService,
          useValue: {
            quote: jest.fn(),
            getPlanStates: jest.fn(),
          },
        },
        { provide: ComplementsService, useValue: complements },
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

  it('a troca de plano antiga está aposentada', () => {
    expect(() => controller.upgrade()).toThrow(GoneException);
  });

  it('adicionar e retirar módulo passam pela regra dos complementos', async () => {
    const req = {
      user: { userId: 'user-1', companyId: 'company-1', isAdmin: true },
    };
    await controller.addModule('sub-1', 'nota_fiscal', undefined as any, req);
    await controller.removeModule('sub-1', 'nota_fiscal', req);

    const user = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
    expect(complements.legacyAddModule).toHaveBeenCalledWith(
      user,
      'sub-1',
      'nota_fiscal',
      undefined,
    );
    expect(complements.removeModule).toHaveBeenCalledWith(
      user,
      'sub-1',
      'nota_fiscal',
    );
  });
});

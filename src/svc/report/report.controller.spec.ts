import { Test, TestingModule } from '@nestjs/testing';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { AbacService } from '../../core/auth/abac/abac.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('ReportController', () => {
  let controller: ReportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [
        {
          provide: ReportService,
          useValue: {
            menu: jest.fn().mockResolvedValue({
              sales: { quotations: 0, orders: 0 },
              financial: { receivable: 0, payable: 0 },
              production: { followUp: 0, production: 0 },
            }),
          },
        },
        {
          provide: AbacService,
          useValue: {
            hasPermission: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            company: { findUnique: jest.fn() },
          },
        },
      ],
    }).compile();

    controller = module.get<ReportController>(ReportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

describe('ReportController: comissão de outros vendedores (EC-25)', () => {
  const service = {
    getCommissionSummary: jest.fn(),
    getCommissionTable: jest.fn(),
  };
  const abac = { canAccessOtherSellers: jest.fn() };
  const controller = new ReportController(service as any, abac as any);
  const seller = {
    user: { companyId: 'c-1', employeeId: 'e-1', isAdmin: false, role: 'r' },
  };
  const routes = ['getCommissionSummary', 'getCommissionTable'] as const;

  beforeEach(() => jest.clearAllMocks());

  it.each(routes)(
    '%s fixa o vendedor de quem não vê outros vendedores',
    async (method) => {
      abac.canAccessOtherSellers.mockResolvedValue(false);
      await controller[method]({ sellerId: 'e-2' }, seller as any);
      expect(abac.canAccessOtherSellers).toHaveBeenCalledWith(seller.user);
      expect(service[method]).toHaveBeenCalledWith('c-1', {
        sellerId: 'e-1',
      });
    },
  );

  it.each(routes)(
    '%s sem vendedor no filtro também fica só no próprio',
    async (method) => {
      abac.canAccessOtherSellers.mockResolvedValue(false);
      await controller[method]({}, seller as any);
      expect(service[method]).toHaveBeenCalledWith('c-1', {
        sellerId: 'e-1',
      });
    },
  );

  it.each(routes)(
    '%s mantém o filtro de quem vê outros vendedores',
    async (method) => {
      abac.canAccessOtherSellers.mockResolvedValue(true);
      await controller[method]({ sellerId: 'e-2' }, seller as any);
      expect(service[method]).toHaveBeenCalledWith('c-1', {
        sellerId: 'e-2',
      });
    },
  );

  it.each(routes)('%s não restringe o administrador', async (method) => {
    abac.canAccessOtherSellers.mockResolvedValue(false);
    const admin = { user: { ...seller.user, isAdmin: true } };
    await controller[method]({}, admin as any);
    expect(service[method]).toHaveBeenCalledWith('c-1', {});
  });
});

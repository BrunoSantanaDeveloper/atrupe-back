import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { CompanyManagementService } from './company-management.service';
import { SubscriptionBlockService } from './subscription-block.service';
import { SubscriptionQuoteService } from './pricing/subscription-quote.service';
import { ComplementsService } from './checkout/complements.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  const complements = {
    removeModule: jest.fn(),
  };
  const companyManagement = {
    getCompanyDetails: jest.fn(),
    updatePlan: jest.fn(),
    syncCustomerAddressToAsaas: jest.fn(),
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
        { provide: CompanyManagementService, useValue: companyManagement },
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

  it('as rotas da tela antiga de assinatura foram aposentadas', () => {
    const routes = controller as unknown as Record<string, unknown>;
    // Contratação antiga, troca livre de plano e "adicionar módulo" avulso:
    // a contratação, a evolução e os complementos da tela nova substituem.
    expect(routes.create).toBeUndefined();
    expect(routes.changePlan).toBeUndefined();
    expect(routes.upgrade).toBeUndefined();
    expect(routes.addModule).toBeUndefined();
  });

  it('retirar módulo passa pela regra dos complementos', async () => {
    const req = {
      user: { userId: 'user-1', companyId: 'company-1', isAdmin: true },
    };
    await controller.removeModule('sub-1', 'nota_fiscal', req);

    const user = { userId: 'user-1', companyId: 'company-1', isAdmin: true };
    expect(complements.removeModule).toHaveBeenCalledWith(
      user,
      'sub-1',
      'nota_fiscal',
    );
  });

  it('o endereço do Asaas confere a senha do superadmin logado', async () => {
    // A estratégia JWT põe o id do usuário em `userId`; com `req.user.id`
    // o serviço buscava o administrador por id indefinido e a rota falhava
    // com qualquer senha.
    const req = {
      user: { userId: 'admin-1', companyId: 'company-1', isAdmin: true },
    };
    const dto = { password: 'senha', postalCode: '89201-000' };
    await controller.syncAddressToAsaas('company-2', dto as never, req);

    expect(companyManagement.syncCustomerAddressToAsaas).toHaveBeenCalledWith(
      'company-2',
      dto,
      'admin-1',
    );
  });

  // A assinatura saiu do cargo (pacote de 26/10/2026, item 8): ver, cotar,
  // conferir o pagamento e cancelar pedem o administrador
  describe('só o administrador vê e gerencia a assinatura', () => {
    const colaborador = { user: { userId: 'u-2', companyId: 'c-1' } };

    it.each([
      ['plan-states', () => controller.planStates(colaborador)],
      ['quote', () => controller.quote({} as any, colaborador)],
      ['active', () => controller.getActive(colaborador)],
      ['check-status', () => controller.checkSubscriptionStatus(colaborador)],
      [
        'cancel',
        () => controller.cancelSubscription('s-1', {} as any, colaborador),
      ],
    ])('%s recusa quem não é administrador', async (_route, call) => {
      await expect(call()).rejects.toThrow(
        'Só o administrador da conta vê e gerencia a assinatura',
      );
    });
  });
});

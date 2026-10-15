import { Test, TestingModule } from '@nestjs/testing';
import {
  ALREADY_APPROVED_MESSAGE,
  INACTIVE_PRODUCT_ITEMS,
  PAYMENT_CONDITION_REQUIRED,
  QuotationWorkflowService,
} from './quotation-workflow.service';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { PrismaService } from 'nestjs-prisma';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { CreditCheckService } from './credit-check.service';
import { ProductionProjectService } from '../../production/production-project.service';
import { QUICK_SALE_CHARGE_REQUIRED } from '../quick-sale/quick-sale.rules';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { QuotationStatus, OrderStatus } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';
const mockOrderId = 'order-uuid-789';
const mockUserId = 'user-uuid-101';
const mockUserName = 'Test User';

const mockOrder = {
  id: mockOrderId,
  quotationId: mockQuotationId,
  status: OrderStatus.IN_PRODUCTION,
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  status: QuotationStatus.OPEN,
  totalValue: 10000,
};

/** O orçamento como a transação da aprovação o lê, já aprovado. */
const approvedQuotation = (overrides: Record<string, unknown> = {}) => ({
  ...mockQuotation,
  status: QuotationStatus.APPROVED,
  approvedAt: new Date('2026-10-12T12:00:00Z'),
  deliveryInfo: { id: 'delivery-info-id', daysAfterApproval: 7 },
  quotationPayment: { billing: 'ON_ORDER', paymentCondition: null },
  client: { status: 'ACTIVE' },
  series: { productionStatus: 'IN_PRODUCTION' },
  ...overrides,
});

// A consulta dos itens montados sem etapa (MS-12) responde vazio; as outras
// consultas de itens, o que o teste pedir
const itemsOnly =
  (rows: unknown[] | Error) => (args?: { where?: { origin?: string } }) =>
    args?.where?.origin === 'COMPOSED'
      ? Promise.resolve([])
      : rows instanceof Error
        ? Promise.reject(rows)
        : Promise.resolve(rows);

const createMockPrismaService = () => ({
  // O perfil do vendedor (somente enviar ao caixa, FC-12.1): sem perfil
  employee: { findFirst: jest.fn().mockResolvedValue(null) },
  quotation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  deliveryInfo: {
    update: jest.fn(),
  },
  deliverySchedule: {
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  receivable: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  payable: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  reasons: {
    findFirst: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
  productionStage: {
    createMany: jest.fn(),
    count: jest.fn(),
  },
  companySector: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({ name: mockUserName }),
  },
  sellerProfile: {
    findFirst: jest.fn(),
  },
  quotationHistory: {
    create: jest.fn(),
  },
  orderHistory: {
    create: jest.fn(),
  },
  // Os passos de depois da aprovação (Fase 4.3)
  quotationProduct: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  quotationItemSnapshot: {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    // O retrato dos itens montados para as etapas da agenda (ORC-11)
    findMany: jest.fn().mockResolvedValue([]),
  },
  quotationItemLine: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  productionProject: {
    count: jest.fn().mockResolvedValue(0),
  },
  // A venda rápida (Fase 7.3): sem configuração, cobrada na hora
  quickSaleSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  pendingSale: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'ps-1' }),
  },
  bankAccount: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  $transaction: jest.fn(),
});

const mockFinancialService = {
  generateReceivableFromQuotation: jest.fn(),
  generatePayableFromQuotation: jest.fn(),
};

const mockDeliveryScheduleService = {
  create: jest.fn(),
};

const mockPlanControl = {
  getCompanyPlanInfo: jest.fn(),
  hasFeature: jest.fn().mockResolvedValue(true),
};

const mockProductSale = {
  itemComposition: jest.fn(),
};

// O crédito tem teste próprio (credit-check.service.spec.ts)
const mockCredit = { assertApproval: jest.fn().mockResolvedValue(undefined) };
// O projeto de produção (ELITE): fora do ELITE, nada nasce
const mockProduction = {
  ensureFromQuotation: jest.fn().mockResolvedValue(undefined),
  summaryOf: jest.fn().mockResolvedValue(null),
};

describe('QuotationWorkflowService', () => {
  let service: QuotationWorkflowService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationWorkflowService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: QuotationFinancialService,
          useValue: mockFinancialService,
        },
        {
          provide: DeliveryScheduleService,
          useValue: mockDeliveryScheduleService,
        },
        {
          provide: PlanControlService,
          useValue: mockPlanControl,
        },
        { provide: ProductSaleService, useValue: mockProductSale },
        { provide: CreditCheckService, useValue: mockCredit },
        { provide: ProductionProjectService, useValue: mockProduction },
      ],
    }).compile();

    service = module.get<QuotationWorkflowService>(QuotationWorkflowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('approve', () => {
    // Transação de mentira com a semântica do banco: o que o callback grava
    // só vale se ele terminar sem erro
    let committed: string[];
    let pending: string[];
    let claimCount: number;
    let txQuotation: Record<string, unknown>;
    let logError: jest.SpyInstance;

    const currentQuotation = (overrides: Record<string, unknown> = {}) => ({
      companyId: mockCompanyId,
      status: QuotationStatus.DONE,
      quickSale: false,
      client: { status: 'ACTIVE' },
      deliveryInfo: { id: 'delivery-info-id' },
      quotationPayment: {
        billing: 'ON_ORDER',
        _count: { quotationInstallment: 1 },
      },
      quotationProduct: [],
      ...overrides,
    });

    beforeEach(() => {
      committed = [];
      claimCount = 1;
      txQuotation = approvedQuotation();
      logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      prisma.quotation.findUnique.mockImplementation(async (args) =>
        args.select
          ? currentQuotation()
          : { ...mockQuotation, quotationProduct: [], deliveryInfo: null },
      );
      mockPlanControl.getCompanyPlanInfo.mockResolvedValue({
        features: { delivery_production_tabs: true },
      });
      mockFinancialService.generateReceivableFromQuotation.mockImplementation(
        async () => pending.push('receivable'),
      );
      mockFinancialService.generatePayableFromQuotation.mockImplementation(
        async () => pending.push('payable'),
      );

      prisma.$transaction.mockImplementation(async (callback) => {
        pending = [];
        const result = await callback({
          quotation: {
            updateMany: jest.fn(async ({ data }) => {
              if (claimCount > 0) pending.push(`quotation:${data.status}`);
              return { count: claimCount };
            }),
            findUniqueOrThrow: jest.fn(async () => txQuotation),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(async () => {
              pending.push('order');
              return mockOrder;
            }),
          },
          deliveryInfo: { update: jest.fn() },
          deliverySchedule: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(async ({ data }) => {
              pending.push(`deliverySchedule:${data.status}`);
            }),
          },
          receivable: { findMany: jest.fn().mockResolvedValue([]) },
          payable: { findMany: jest.fn().mockResolvedValue([]) },
          // A fila da frente de caixa (FC-12)
          pendingSale: prisma.pendingSale,
        });
        committed.push(...pending);
        return result;
      });
    });

    afterEach(() => {
      logError.mockRestore();
    });

    it('aprova numa transação só: status, O.S., agenda e financeiro', async () => {
      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result.id).toBe(mockOrderId);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(committed).toEqual([
        'quotation:APPROVED',
        'order',
        'deliverySchedule:IN_PRODUCTION',
        'receivable',
        'payable',
      ]);
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'APPROVED',
          createdBy: mockUserId,
        }),
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: mockOrderId,
          action: 'CREATED',
          createdBy: mockUserId,
        }),
      });
    });

    it('o projeto de produção nasce depois do retrato e volta na resposta (ELITE)', async () => {
      const calls: string[] = [];
      prisma.quotationProduct.findMany.mockImplementation(async () => {
        calls.push('snapshots');
        return [];
      });
      mockProduction.ensureFromQuotation.mockImplementationOnce(async () => {
        calls.push('productionProject');
      });
      mockProduction.summaryOf.mockResolvedValueOnce({
        id: 'pj-1',
        tasks: 3,
        status: 'STANDBY',
      });

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(mockProduction.ensureFromQuotation).toHaveBeenCalledWith(
        mockQuotationId,
      );
      expect(calls.indexOf('productionProject')).toBeGreaterThan(
        calls.indexOf('snapshots'),
      );
      expect(result.productionProject).toEqual({
        id: 'pj-1',
        tasks: 3,
        status: 'STANDBY',
      });
    });

    it('falha ao criar o projeto não desfaz a venda aprovada', async () => {
      mockProduction.ensureFromQuotation.mockRejectedValueOnce(
        new Error('Nenhum gerenciador de produção ativo'),
      );

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result.id).toBe(mockOrderId);
      expect(result.productionProject).toBeNull();
    });

    it('falha no financeiro desfaz a aprovação inteira: nada fica APPROVED', async () => {
      mockFinancialService.generateReceivableFromQuotation.mockRejectedValue(
        new BadRequestException('Não há parcelas para gerar contas a receber.'),
      );

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow('Não há parcelas para gerar contas a receber.');
      expect(committed).toEqual([]);
      expect(prisma.quotation.update).not.toHaveBeenCalled();
      expect(prisma.productionStage.createMany).not.toHaveBeenCalled();
      expect(prisma.quotationHistory.create).not.toHaveBeenCalled();
    });

    it('orçamento já aprovado: 409, sem abrir transação', async () => {
      prisma.quotation.findUnique.mockResolvedValue(
        currentQuotation({ status: QuotationStatus.APPROVED }),
      );

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(new ConflictException(ALREADY_APPROVED_MESSAGE));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('dois cliques: a segunda aprovação encontra o orçamento aprovado (409)', async () => {
      claimCount = 0;

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(committed).toEqual([]);
    });

    it('sem informações de entrega: 400 antes de gravar', async () => {
      prisma.quotation.findUnique.mockResolvedValue(
        currentQuotation({ deliveryInfo: null }),
      );

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(
        new BadRequestException('Informações de entrega ausentes na venda.'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cliente com cadastro não regular e usuário sem permissão: 400 antes de gravar', async () => {
      prisma.quotation.findUnique.mockResolvedValue(
        currentQuotation({ client: { status: 'PROSPECT' } }),
      );
      prisma.user.findUnique.mockResolvedValue({ employee: [] });
      prisma.sellerProfile.findFirst.mockResolvedValue({
        canApprovePreRegistration: false,
      });

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('sem a chave das abas de produção, a agenda nasce na entrega', async () => {
      mockPlanControl.getCompanyPlanInfo.mockResolvedValue({ features: {} });

      await service.approve(mockQuotationId, mockUserId);

      expect(committed).toContain('deliverySchedule:DELIVERING');
    });

    it('empresa sem assinatura: a agenda nasce em produção, como antes', async () => {
      mockPlanControl.getCompanyPlanInfo.mockResolvedValue(null);

      await service.approve(mockQuotationId, mockUserId);

      expect(committed).toContain('deliverySchedule:IN_PRODUCTION');
    });

    it('financeiro na aprovação só com a cobrança no pedido', async () => {
      txQuotation = approvedQuotation({
        quotationPayment: { billing: 'ON_DELIVERY', paymentCondition: null },
      });

      await service.approve(mockQuotationId, mockUserId);

      expect(committed).toEqual([
        'quotation:APPROVED',
        'order',
        'deliverySchedule:IN_PRODUCTION',
      ]);
    });

    it('falha nas etapas de produção não desfaz a venda aprovada', async () => {
      prisma.quotation.findUnique.mockImplementation(async (args) =>
        args.select
          ? currentQuotation()
          : {
              ...mockQuotation,
              quotationProduct: [{ productId: 'product-1' }],
              deliveryInfo: {
                deliveryType: 'INSTALLATION',
                deliverySchedule: { id: 'schedule-1' },
              },
            },
      );
      prisma.productionStage.count.mockResolvedValue(0);
      prisma.product.findMany.mockRejectedValue(new Error('banco fora'));

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result.id).toBe(mockOrderId);
      expect(committed).toContain('quotation:APPROVED');
      expect(logError).toHaveBeenCalled();
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(service.approve('invalid-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('sem condição de pagamento: 400 antes de gravar; a venda rápida passa', async () => {
      prisma.quotation.findUnique.mockImplementation(async (args) =>
        args.select
          ? currentQuotation({
              quotationPayment: {
                billing: 'ON_ORDER',
                _count: { quotationInstallment: 0 },
              },
            })
          : { ...mockQuotation, quotationProduct: [], deliveryInfo: null },
      );
      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(new BadRequestException(PAYMENT_CONDITION_REQUIRED));
      expect(prisma.$transaction).not.toHaveBeenCalled();

      prisma.quotation.findUnique.mockImplementation(async (args) =>
        args.select
          ? currentQuotation({
              quickSale: true,
              quotationPayment: {
                billing: 'ON_ORDER',
                _count: { quotationInstallment: 0 },
              },
            })
          : { ...mockQuotation, quotationProduct: [], deliveryInfo: null },
      );
      // Cobrada na hora: só o "Cobrar" aprova (VR-5)
      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(new BadRequestException(QUICK_SALE_CHARGE_REQUIRED));
      // Enviada ao caixa: aprova sem condição, entra na fila e não gera o
      // título da condição (FC-1, FC-12)
      prisma.quickSaleSettings.findUnique.mockResolvedValue({ payment: 'POS' });
      await service.approve(mockQuotationId, mockUserId);
      expect(committed).toContain('quotation:APPROVED');
      expect(prisma.pendingSale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'QUICK', path: 'POS' }),
        }),
      );
      expect(
        mockFinancialService.generateReceivableFromQuotation,
      ).not.toHaveBeenCalled();
    });

    it('produto ou parte inativa: 400 com os itens a trocar (PAD-7)', async () => {
      prisma.quotation.findUnique.mockResolvedValue(
        currentQuotation({
          quotationProduct: [
            {
              id: 'item-1',
              description: 'Banner 440',
              product: { name: 'Banner', isActive: false },
              lines: [],
            },
            {
              id: 'item-2',
              description: 'Fachada',
              product: { name: 'Fachada', isActive: true },
              lines: [{ product: { isActive: false } }],
            },
            {
              id: 'item-3',
              description: 'Cartão',
              product: { name: 'Cartão', isActive: true },
              lines: [{ product: { isActive: true } }],
            },
          ],
        }),
      );

      const error = await service
        .approve(mockQuotationId, mockUserId)
        .catch((reason) => reason);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        message: INACTIVE_PRODUCT_ITEMS,
        items: [
          { itemId: 'item-1', name: 'Banner 440' },
          { itemId: 'item-2', name: 'Fachada' },
        ],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('depois da aprovação: o retrato que falta e a conta do terceirizado (T-3)', async () => {
      prisma.quotationProduct.findMany.mockImplementation(
        itemsOnly([
          {
            id: 'item-1',
            productId: 'product-1',
            variationId: null,
            quantity: 2,
            composition: { choices: [] },
            items: [{ width: 900, height: 1200 }],
            product: { companyId: mockCompanyId },
            quotation: { companyId: mockCompanyId },
          },
        ]),
      );
      mockProductSale.itemComposition.mockResolvedValue({
        snapshot: { cost: 1500, stages: [] },
      });
      prisma.payable.count.mockResolvedValue(0);
      prisma.quotationItemLine.findMany.mockResolvedValue([
        {
          name: 'Letra caixa',
          cost: 20000,
          supplierId: 'fornecedor-1',
          supplierName: 'Letras & Cia',
          quotationProduct: {
            quotation: {
              companyId: mockCompanyId,
              quotationNumber: 3352,
              series: { code: 'V1' },
            },
          },
        },
      ]);
      const payableCreate = jest.fn().mockResolvedValue({ id: 'payable-1' });
      const installmentCreate = jest.fn();
      const approvalTx = prisma.$transaction.getMockImplementation();
      prisma.$transaction.mockImplementation(async (callback) =>
        committed.includes('quotation:APPROVED')
          ? callback({
              payable: { create: payableCreate },
              payableInstallment: { create: installmentCreate },
            })
          : approvalTx!(callback),
      );

      await service.approve(mockQuotationId, mockUserId);

      expect(mockProductSale.itemComposition).toHaveBeenCalledWith(
        mockCompanyId,
        'product-1',
        null,
        { quantity: 2, width: 900, height: 1200 },
        { choices: [] },
      );
      expect(prisma.quotationItemSnapshot.create).toHaveBeenCalledWith({
        data: {
          quotationProductId: 'item-1',
          data: { cost: 1500, stages: [] },
        },
      });
      expect(payableCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description:
            'Terceirizado da venda 3352-V1: Letra caixa (Letras & Cia)',
          totalAmount: 20000,
          supplierId: 'fornecedor-1',
          quotationId: mockQuotationId,
          financialType: 'OUTSOURCED',
        }),
      });
      expect(installmentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payableId: 'payable-1',
          amount: 20000,
          installmentNumber: 1,
        }),
      });
    });

    it('falha no retrato não desfaz a venda e não impede a conta do terceirizado', async () => {
      prisma.quotationProduct.findMany.mockImplementation(
        itemsOnly(new Error('motor fora')),
      );

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result.id).toBe(mockOrderId);
      expect(committed).toContain('quotation:APPROVED');
      expect(prisma.quotationItemLine.findMany).toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('snapshots não criado'),
      );
    });
  });

  describe('reprocessApproval', () => {
    // Venda aprovada pela metade: O.S. criada, sem agenda, financeiro nem
    // etapas (o estado que a aprovação em duas transações deixava)
    let state: {
      order: number;
      deliverySchedule: number;
      receivables: number;
      payables: number;
      productionStages: number;
    };
    let orderStatus: OrderStatus;
    let logError: jest.SpyInstance;

    beforeEach(() => {
      state = {
        order: 1,
        deliverySchedule: 0,
        receivables: 0,
        payables: 0,
        productionStages: 0,
      };
      orderStatus = OrderStatus.IN_PRODUCTION;
      logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      prisma.quotation.findUnique.mockImplementation(async (args) =>
        args.select
          ? {
              companyId: mockCompanyId,
              status: QuotationStatus.APPROVED,
              order: { status: orderStatus },
            }
          : {
              ...mockQuotation,
              quotationProduct: [{ productId: 'product-1' }],
              deliveryInfo: {
                deliveryType: 'PICKUP',
                deliverySchedule: state.deliverySchedule
                  ? { id: 'schedule-1' }
                  : null,
              },
            },
      );
      prisma.order.count.mockImplementation(async () => state.order);
      prisma.deliverySchedule.count.mockImplementation(
        async () => state.deliverySchedule,
      );
      prisma.receivable.count.mockImplementation(async () => state.receivables);
      prisma.payable.count.mockImplementation(async (args) =>
        args?.where?.financialType === 'OUTSOURCED' ? 0 : state.payables,
      );
      prisma.productionStage.count.mockImplementation(
        async () => state.productionStages,
      );
      prisma.productionStage.createMany.mockImplementation(async ({ data }) => {
        state.productionStages += data.length;
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'product-1',
          productionStages: [
            { id: 'sector-1', isActive: true },
            { id: 'sector-2', isActive: false },
          ],
        },
      ]);
      prisma.companySector.findFirst.mockResolvedValue({ id: 'sector-pickup' });
      mockPlanControl.getCompanyPlanInfo.mockResolvedValue({
        features: { delivery_production_tabs: true },
      });
      mockFinancialService.generateReceivableFromQuotation.mockImplementation(
        async () => state.receivables++,
      );
      mockFinancialService.generatePayableFromQuotation.mockImplementation(
        async () => state.payables++,
      );

      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          quotation: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(approvedQuotation()),
          },
          order: {
            findUnique: jest.fn(async () => (state.order ? mockOrder : null)),
            create: jest.fn(async () => {
              state.order++;
              return mockOrder;
            }),
          },
          deliveryInfo: { update: jest.fn() },
          deliverySchedule: {
            findFirst: jest.fn(async () =>
              state.deliverySchedule ? { id: 'schedule-1' } : null,
            ),
            create: jest.fn(async () => {
              state.deliverySchedule++;
            }),
          },
          receivable: {
            findMany: jest.fn(async () =>
              state.receivables ? [{ id: 'receivable-1' }] : [],
            ),
          },
          payable: {
            findMany: jest.fn(async () =>
              state.payables ? [{ id: 'payable-1' }] : [],
            ),
          },
        }),
      );
    });

    afterEach(() => {
      logError.mockRestore();
    });

    it('completa o que falta sem mudar o status, e rodar de novo não duplica nada', async () => {
      const first = await service.reprocessApproval(
        mockQuotationId,
        mockUserId,
      );

      expect(first).toEqual({
        orderId: mockOrderId,
        created: [
          'deliverySchedule',
          'receivables',
          'payables',
          'productionStages',
        ],
        failed: [],
      });
      expect(prisma.productionStage.createMany).toHaveBeenCalledWith({
        data: [
          {
            stageId: 'sector-1',
            order: 1,
            prevStatus: null,
            scheduleId: 'schedule-1',
          },
          {
            stageId: 'sector-pickup',
            order: 2,
            prevStatus: null,
            scheduleId: 'schedule-1',
          },
        ],
      });
      expect(prisma.quotation.update).not.toHaveBeenCalled();
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'APPROVAL_REPROCESSED',
          createdBy: mockUserId,
        }),
      });

      const second = await service.reprocessApproval(
        mockQuotationId,
        mockUserId,
      );

      expect(second).toEqual({ orderId: mockOrderId, created: [], failed: [] });
      expect(state).toEqual({
        order: 1,
        deliverySchedule: 1,
        receivables: 1,
        payables: 1,
        productionStages: 2,
      });
      expect(prisma.productionStage.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.quotationHistory.create).toHaveBeenCalledTimes(1);
    });

    it('venda que não está aprovada: 409', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        companyId: mockCompanyId,
        status: QuotationStatus.DONE,
        order: null,
      });

      await expect(
        service.reprocessApproval(mockQuotationId, mockUserId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('O.S. cancelada: 409, sem recriar agenda nem financeiro', async () => {
      orderStatus = OrderStatus.CANCELED;

      await expect(
        service.reprocessApproval(mockQuotationId, mockUserId),
      ).rejects.toThrow('A ordem de serviço desta venda foi cancelada.');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('etapa que falha de novo volta em failed, com o resto completado', async () => {
      prisma.product.findMany.mockRejectedValue(new Error('banco fora'));

      const result = await service.reprocessApproval(
        mockQuotationId,
        mockUserId,
      );

      expect(result.created).toEqual([
        'deliverySchedule',
        'receivables',
        'payables',
      ]);
      expect(result.failed).toEqual([
        { step: 'productionStages', message: 'banco fora' },
      ]);
    });
  });

  describe('reject', () => {
    it('motivo de outra empresa: 404 com a mensagem, sem rejeitar', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
      });
      prisma.reasons.findFirst.mockResolvedValue(null);

      await expect(
        service.reject(mockQuotationId, { reasonId: 'reason-b' }, mockUserId),
      ).rejects.toThrow(
        new NotFoundException('Motivo de cancelamento não encontrado.'),
      );
      expect(prisma.reasons.findFirst).toHaveBeenCalledWith({
        where: { id: 'reason-b', companyId: mockCompanyId },
      });
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });

    it('should reject quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.REJECTED,
      });

      const result = await service.reject(mockQuotationId, {}, mockUserId);

      expect(result.status).toBe(QuotationStatus.REJECTED);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'REJECTED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw BadRequestException if quotation is approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(
        service.reject(mockQuotationId, {}, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(
        service.reject('invalid-id', {}, mockUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('open', () => {
    it('should reopen quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.REJECTED,
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
      });

      const result = await service.open(mockQuotationId, mockUserId);

      expect(result.status).toBe(QuotationStatus.OPEN);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'REOPENED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw BadRequestException if quotation is approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(service.open(mockQuotationId, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('finish', () => {
    it('should finish quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
        seller: {
          sellerProfile: { minValue: 0, maxDiscount: 50 },
        },
        quotationPayment: {
          billing: 'ON_ORDER',
          quotationInstallment: [{}],
          finalValue: 10000,
        },
        quotationProduct: [],
        series: { proposalValidity: 30 },
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
        finishedAt: new Date(),
      });

      const result = await service.finish(mockQuotationId, mockUserId);

      expect(result.status).toBe(QuotationStatus.DONE);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'FINISHED',
          createdBy: mockUserId,
        }),
      });
    });

    // Itens do orçamento #3352-V1, que reproduziu o defeito em produção.
    const itensDeCemPorCento = [
      { totalValue: 29970 },
      { totalValue: 36000 },
      { totalValue: 50403 },
    ];

    const mockFinishWithDiscount = (
      maxDiscount: number,
      finalValue: number,
    ) => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
        seller: { sellerProfile: { minValue: 0, maxDiscount } },
        quotationPayment: {
          billing: 'ON_ORDER',
          quotationInstallment: [{}],
          finalValue,
        },
        quotationProduct: itensDeCemPorCento,
        series: { proposalValidity: 30 },
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
        finishedAt: new Date(),
      });
    };

    it('aceita desconto de exatamente o limite do vendedor', async () => {
      // 10% de 116373 dá 10.000000000000002 em ponto flutuante: sem o
      // arredondamento, o checkout recusava dizendo "10.00% excede 10%".
      mockFinishWithDiscount(10, 104735.7);

      const result = await service.finish(mockQuotationId, mockUserId);

      expect(result.status).toBe(QuotationStatus.DONE);
    });

    it('continua recusando desconto acima do limite do vendedor', async () => {
      // 116373 -> 103000 é 11,49% de desconto
      mockFinishWithDiscount(10, 103000);

      await expect(service.finish(mockQuotationId, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(service.finish(mockQuotationId, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('conclui sem condição de pagamento (sem parcelas): só a aprovação exige', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
        seller: { sellerProfile: { minValue: 0, maxDiscount: 50 } },
        quotationPayment: { billing: 'ON_ORDER', quotationInstallment: [] },
        quotationProduct: [],
        series: { proposalValidity: 30 },
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
      });

      await expect(
        service.finish(mockQuotationId, mockUserId),
      ).resolves.toMatchObject({ status: QuotationStatus.DONE });
    });

    it('acréscimo e linhas acrescentadas não contam como desconto (ALT-25, ORC-5)', async () => {
      // Base 100,00 com 10,00 de desconto, 30,00 de acréscimo e 50,00 de
      // linhas: o valor final 170,00 tem 10 % de desconto, não menos
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        totalValue: 17000,
        status: QuotationStatus.OPEN,
        seller: { sellerProfile: { minValue: 0, maxDiscount: 5 } },
        quotationPayment: {
          billing: 'ON_ORDER',
          quotationInstallment: [{}],
          finalValue: 17000,
        },
        quotationProduct: [
          { totalValue: 10000, addition: 3000, linesTotal: 5000 },
        ],
        series: { proposalValidity: 30 },
      });

      await expect(service.finish(mockQuotationId, mockUserId)).rejects.toThrow(
        'O desconto aplicado (10.00%) excede o limite máximo permitido para este vendedor (5%).',
      );
    });
  });

  describe('billQuotation', () => {
    it('should skip if financials already exist', async () => {
      prisma.$transaction.mockResolvedValue({
        receivables: [{ id: 'existing-receivable' }],
        payables: [],
      });

      const result = await service.billQuotation(mockQuotationId);

      expect(result).toBeDefined();
    });
  });
});

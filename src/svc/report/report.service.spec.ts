import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { PrismaService } from 'nestjs-prisma';
import { QuotationService } from '../../core/sale/quotation/quotation.service';
import { OrderService } from '../../core/sale/order/order.service';
import { PayableService } from '../../core/financial/payable/payable.service';
import { ReceivableService } from '../../core/financial/receivable/receivable.service';

describe('ReportService', () => {
  let service: ReportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: PrismaService,
          useValue: {
            order: { findMany: jest.fn(), count: jest.fn() },
            quotation: { findMany: jest.fn(), groupBy: jest.fn() },
            quotationProduct: { findMany: jest.fn() },
            contactSource: { findMany: jest.fn() },
          },
        },
        {
          provide: QuotationService,
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: OrderService,
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: PayableService,
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: ReceivableService,
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('menu', () => {
    it('should return menu counts for a company', async () => {
      const result = await service.menu('company-123');

      expect(result).toEqual({
        sales: { quotations: 0, orders: 0 },
        financial: { receivable: 0, payable: 0 },
        production: { followUp: 0, production: 0 },
      });
    });
  });

  describe('limites do período', () => {
    const getDateRange = (filters: { startDate?: string; endDate?: string }) =>
      (
        service as unknown as {
          getDateRange: (f: unknown) => { startDate: Date; endDate: Date };
        }
      ).getDateRange(filters);

    const getFinancialDateRange = (filters: {
      startDate?: string;
      endDate?: string;
    }) =>
      (
        service as unknown as {
          getFinancialDateRange: (f: unknown) => {
            startDate: Date;
            endDate: Date;
          };
        }
      ).getFinancialDateRange(filters);

    it('cobre o dia inteiro nas pontas, no fuso da operação', () => {
      const { startDate, endDate } = getDateRange({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      expect(startDate.toISOString()).toBe('2026-08-01T03:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-09-01T02:59:59.999Z');
    });

    it('inclui venda aprovada no último dia do período', () => {
      const { startDate, endDate } = getDateRange({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });
      const aprovadaEm31 = new Date('2026-08-31T12:00:00.000Z');

      expect(aprovadaEm31 >= startDate && aprovadaEm31 <= endDate).toBe(true);
    });

    // O relatório financeiro filtra `dueDate`/`paidDate`, que são datas de
    // calendário gravadas à meia-noite UTC — e não instantes como o
    // `approvedAt` das vendas. Por isso a janela aqui fecha em UTC.
    it('fecha a janela do relatório financeiro em UTC', () => {
      const { startDate, endDate } = getFinancialDateRange({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      expect(startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    });

    it('inclui a parcela do dia 1º e deixa de fora a do mês seguinte', () => {
      const { startDate, endDate } = getFinancialDateRange({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });
      const venceNoDia1 = new Date('2026-08-01T00:00:00.000Z');
      const venceNoDia1DeSetembro = new Date('2026-09-01T00:00:00.000Z');

      expect(venceNoDia1 >= startDate && venceNoDia1 <= endDate).toBe(true);
      expect(
        venceNoDia1DeSetembro >= startDate && venceNoDia1DeSetembro <= endDate,
      ).toBe(false);
    });

    it('normaliza para o dia inteiro quando vem data com hora', () => {
      const { startDate, endDate } = getFinancialDateRange({
        startDate: '2026-08-01T03:00:00.000Z',
        endDate: '2026-08-31T03:00:00.000Z',
      });

      expect(startDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    });
  });

  describe('tabela de vendas: data de entrega, cidade e Nº da O.S.', () => {
    const getPrisma = () =>
      (
        service as unknown as {
          prisma: { order: { findMany: jest.Mock; count: jest.Mock } };
        }
      ).prisma;

    const buildOrder = (
      id: string,
      opts: {
        scheduledDate?: string;
        estimatedDate?: string;
        clientCity?: string;
        deliveryCity?: string;
        totalValue?: number;
        deliveryValue?: number;
        discountTotal?: number;
      },
    ) => ({
      id,
      status: 'IN_PRODUCTION',
      deliverySchedule: opts.scheduledDate
        ? { scheduledDate: new Date(opts.scheduledDate) }
        : null,
      quotation: {
        clientId: 'client-1',
        sellerId: 'seller-1',
        quotationNumber: 123,
        description: 'Máquina',
        approvedAt: new Date('2026-08-10T15:00:00.000Z'),
        dueDate: null,
        totalValue: opts.totalValue ?? 1000,
        quotationPayment: {
          discountTotal: opts.discountTotal ?? 0,
          downPaymentAdditionalFee: 0,
          commission: null,
          quotationInstallment: [],
        },
        client: {
          id: 'client-1',
          name: 'Cliente A',
          address: opts.clientCity
            ? [
                { city: 'Outra', type: 'Cobrança' },
                { city: opts.clientCity, type: 'Principal' },
              ]
            : [],
        },
        seller: { id: 'seller-1', name: 'Vendedor' },
        series: { code: 'VD' },
        deliveryInfo: {
          estimatedDate: opts.estimatedDate
            ? new Date(opts.estimatedDate)
            : null,
          value: opts.deliveryValue ?? null,
          clientAddress: opts.deliveryCity ? { city: opts.deliveryCity } : null,
        },
      },
    });

    it('mantém a data de aprovação como padrão do período', async () => {
      const prisma = getPrisma();
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.getSalesTableData('company-1', {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        groupBy: 'none',
      });

      const { where } = prisma.order.findMany.mock.calls[0][0];
      expect(where).toEqual({
        quotation: {
          companyId: 'company-1',
          approvedAt: {
            gte: new Date('2026-09-01T03:00:00.000Z'),
            lte: new Date('2026-10-01T02:59:59.999Z'),
          },
        },
      });
    });

    it('filtra pela entrega: agenda quando há agendamento, senão a previsão', async () => {
      const prisma = getPrisma();
      prisma.order.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);

      await service.getSalesTableData('company-1', {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        groupBy: 'none',
        periodBy: 'deliveryDate',
      });

      const range = {
        gte: new Date('2026-09-01T03:00:00.000Z'),
        lte: new Date('2026-10-01T02:59:59.999Z'),
      };
      const { where } = prisma.order.findMany.mock.calls[0][0];
      expect(where).toEqual({
        quotation: { companyId: 'company-1' },
        OR: [
          { deliverySchedule: { is: { scheduledDate: range } } },
          {
            deliverySchedule: { is: null },
            quotation: { deliveryInfo: { is: { estimatedDate: range } } },
          },
        ],
      });
    });

    it('ordena pela entrega, com a agenda valendo sobre a previsão', async () => {
      const prisma = getPrisma();
      prisma.order.count.mockResolvedValue(3);
      prisma.order.findMany.mockResolvedValue([
        // Reagendada: a previsão era 05/09, a agenda passou para 19/09 às 22h
        // (01h UTC do dia 20)
        buildOrder('reagendada', {
          scheduledDate: '2026-09-20T01:00:00.000Z',
          estimatedDate: '2026-09-05T15:00:00.000Z',
          clientCity: 'Chapecó',
        }),
        buildOrder('sem-data', {}),
        buildOrder('sem-agenda', {
          estimatedDate: '2026-09-10T15:00:00.000Z',
          deliveryCity: 'Xanxerê',
        }),
      ]);

      const result = await service.getSalesTableData('company-1', {
        groupBy: 'none',
        orderBy: 'deliveryDate',
        limit: 10,
      });

      const query = prisma.order.findMany.mock.calls[0][0];
      expect(query.take).toBeUndefined();
      expect(query.skip).toBeUndefined();

      if (!('records' in result)) {
        throw new Error('esperava tabela sem agrupamento');
      }
      expect(
        result.records.map((r) => [
          r.id,
          r.osNumber,
          r.clientCity,
          r.deliveryDate,
        ]),
      ).toEqual([
        ['sem-agenda', '123-VD', 'Xanxerê', '10/09/2026'],
        ['reagendada', '123-VD', 'Chapecó', '19/09/2026'],
        ['sem-data', '123-VD', null, null],
      ]);
    });

    it('tira o desconto do valor da linha e soma o total do período', async () => {
      const prisma = getPrisma();
      prisma.order.count.mockResolvedValue(2);
      prisma.order.findMany.mockResolvedValue([
        buildOrder('com-desconto', { totalValue: 2500, discountTotal: 270 }),
        buildOrder('com-frete', { totalValue: 1000, deliveryValue: 150 }),
      ]);

      const result = await service.getSalesTableData('company-1', {
        groupBy: 'none',
        orderBy: 'valueDesc',
        limit: 10,
      });

      if (!('records' in result)) {
        throw new Error('esperava tabela sem agrupamento');
      }
      expect(result.records.map((r) => [r.id, r.value])).toEqual([
        ['com-desconto', 2230],
        ['com-frete', 1150],
      ]);
      // Total do período, base da porcentagem — igual à do PDF
      expect(result.totalValue).toBe(3380);
    });

    it('pagina em memória quando ordena pela entrega', async () => {
      const prisma = getPrisma();
      prisma.order.count.mockResolvedValue(2);
      prisma.order.findMany.mockResolvedValue([
        buildOrder('depois', { estimatedDate: '2026-09-20T15:00:00.000Z' }),
        buildOrder('antes', { estimatedDate: '2026-09-10T15:00:00.000Z' }),
      ]);

      const result = await service.getSalesTableData('company-1', {
        groupBy: 'none',
        orderBy: 'deliveryDate',
        page: 2,
        limit: 1,
      });

      if (!('records' in result)) {
        throw new Error('esperava tabela sem agrupamento');
      }
      expect(result.records.map((r) => r.id)).toEqual(['depois']);
      expect(result.pagination.totalPages).toBe(2);
    });
  });

  describe('relatório de produtos vendidos', () => {
    const getPrisma = () =>
      (
        service as unknown as {
          prisma: { quotationProduct: { findMany: jest.Mock } };
        }
      ).prisma;

    // 1m x 1m por peça, salvo em milímetros
    const areaItem = (overrides: Record<string, unknown> = {}) => ({
      quantity: 1,
      originalQuantity: 1,
      unitKind: 'AREA',
      width: 1000,
      height: 1000,
      length: null,
      volume: null,
      weight: null,
      distance: null,
      duration: null,
      ...overrides,
    });

    const buildProduct = (
      overrides: Record<string, unknown> = {},
      items: unknown[] = [areaItem()],
    ) => ({
      productId: 'p1',
      quantity: 1,
      finalValue: 100,
      totalValue: 100,
      product: { id: 'p1', name: 'Adesivo impresso' },
      items,
      ...overrides,
    });

    it('soma quantidade e valor por produto, com a unidade comercial', async () => {
      getPrisma().quotationProduct.findMany.mockResolvedValue([
        buildProduct({ quantity: 2, finalValue: 500 }, [
          areaItem({ width: 2000 }),
        ]),
        buildProduct({ quantity: 1, finalValue: 250 }),
      ]);

      const result = await service.getProductsSold('company-1', {});

      // 2 peças de 2m² + 1 peça de 1m²
      expect(result.products).toEqual([
        {
          productId: 'p1',
          name: 'Adesivo impresso',
          unit: 'M2',
          quantity: 5,
          value: 750,
        },
      ]);
      expect(result.totalValue).toBe(750);
    });

    it('separa a linha quando o mesmo produto sai como unidade montada', async () => {
      getPrisma().quotationProduct.findMany.mockResolvedValue([
        buildProduct({ quantity: 1, finalValue: 300 }),
        // Produto composto (duas composições) é vendido como peça montada
        buildProduct({ quantity: 3, finalValue: 900 }, [
          areaItem(),
          areaItem({ unitKind: 'WEIGHT', weight: 1_000_000 }),
        ]),
      ]);

      const result = await service.getProductsSold('company-1', {});

      expect(result.products.map((p) => [p.unit, p.quantity, p.value])).toEqual(
        [
          ['UN', 3, 900],
          ['M2', 1, 300],
        ],
      );
      expect(result.totalValue).toBe(1200);
    });

    it('usa o valor do item quando a venda antiga não gravou finalValue', async () => {
      getPrisma().quotationProduct.findMany.mockResolvedValue([
        buildProduct({ finalValue: null, totalValue: 400 }),
      ]);

      const result = await service.getProductsSold('company-1', {});

      expect(result.products[0].value).toBe(400);
    });
  });
});

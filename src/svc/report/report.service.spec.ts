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
            order: { findMany: jest.fn() },
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

    it('aplica os mesmos limites no relatório financeiro', () => {
      const { startDate, endDate } = getFinancialDateRange({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      expect(startDate.toISOString()).toBe('2026-08-01T03:00:00.000Z');
      expect(endDate.toISOString()).toBe('2026-09-01T02:59:59.999Z');
    });
  });
});

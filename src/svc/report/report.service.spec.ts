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
});

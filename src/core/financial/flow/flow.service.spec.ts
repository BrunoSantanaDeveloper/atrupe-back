import { Test, TestingModule } from '@nestjs/testing';
import { FlowService } from './flow.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('FlowService', () => {
  let service: FlowService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      receivableInstallment: {
        findMany: jest.fn(),
      },
      payableInstallment: {
        findMany: jest.fn(),
      },
      receivable: {
        findUnique: jest.fn(),
      },
      payable: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlowService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<FlowService>(FlowService);
  });

  const receivableRow = (iso: string, overrides: any = {}) => ({
    id: 'r-' + iso,
    amount: 0,
    additionalFee: 0,
    paidAmount: 0,
    status: 'PENDING',
    dueDate: new Date(iso),
    paidDate: null,
    provisionDate: null,
    ...overrides,
    receivable: {
      id: 'rec-' + iso,
      description: '',
      status: 'PENDING',
      installmentQty: 1,
      installments: [],
    },
  });

  const payableRow = (iso: string, overrides: any = {}) => ({
    id: 'p-' + iso,
    amount: 0,
    additionalFee: 0,
    paidAmount: 0,
    status: 'PENDING',
    dueDate: new Date(iso),
    paidDate: null,
    provisionDate: null,
    ...overrides,
    payable: {
      id: 'pay-' + iso,
      description: '',
      status: 'PENDING',
      installmentQty: 1,
      installments: [],
    },
  });

  describe('findAllTotals', () => {
    it('should return combined totals for receivables and payables', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        { amount: 100, additionalFee: 10, paidAmount: 50, status: 'PENDING' },
        { amount: 50, additionalFee: 0, paidAmount: 0, status: 'CANCELED' },
      ]);

      prismaMock.payableInstallment.findMany.mockResolvedValue([
        { amount: 200, additionalFee: 20, paidAmount: 100, status: 'PENDING' },
      ]);

      const result = await service.findAllTotals({
        companyId: 'comp-1',
        page: '1',
        limit: '10',
      });

      expect(result).toEqual({
        receivables: expect.objectContaining({
          expected: 110,
          totalPaid: 50,
          open: 60,
          paidCount: 1,
        }),
        payables: expect.objectContaining({
          expected: 220,
          totalPaid: 100,
          open: 120,
          paidCount: 1,
        }),
      });
    });

    it('should not leave a residue in `open` when a settled installment was paid short', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        { amount: 1858, additionalFee: 0, paidAmount: 1815, status: 'PAID' },
        {
          amount: 500,
          additionalFee: 0,
          paidAmount: 500,
          status: 'PROVISIONED',
        },
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAllTotals({
        companyId: 'comp-1',
        dateType: 'paidDate',
        page: '1',
        limit: '10',
      });

      expect(result.receivables.open).toBe(0);
      expect(result.receivables.totalPaid).toBe(2315);
    });

    it('should report overdue as the slice of `open` already past due', async () => {
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 10);
      past.setUTCHours(0, 0, 0, 0);
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 10);
      future.setUTCHours(0, 0, 0, 0);

      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        {
          amount: 300,
          additionalFee: 0,
          paidAmount: null,
          status: 'PENDING',
          dueDate: past,
        },
        {
          amount: 700,
          additionalFee: 0,
          paidAmount: null,
          status: 'PENDING',
          dueDate: future,
        },
        {
          amount: 500,
          additionalFee: 0,
          paidAmount: 500,
          status: 'PAID',
          dueDate: past,
        },
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAllTotals({
        companyId: 'comp-1',
        page: '1',
        limit: '10',
      });

      expect(result.receivables.open).toBe(1000);
      expect(result.receivables.overdue).toBe(300);
      expect(result.receivables.overdueCount).toBe(1);
      expect(result.receivables.paidCount).toBe(1);
    });

    it('should correctly filter by clientId', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      await service.findAllTotals({
        companyId: 'comp-1',
        clientId: 'client-1',
        page: '1',
        limit: '10',
      });

      expect(prismaMock.receivableInstallment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            receivable: expect.objectContaining({ clientId: 'client-1' }),
          }),
        }),
      );
    });

    it('should match provisionDate or paidDate when filtering by payment date', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      await service.findAllTotals({
        companyId: 'comp-1',
        dateType: 'paidDate',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T00:00:00.000Z'),
        page: '1',
        limit: '10',
      });

      const where =
        prismaMock.receivableInstallment.findMany.mock.calls[0][0].where;

      expect(where.AND[0].OR).toEqual([
        { provisionDate: expect.any(Object) },
        { provisionDate: null, paidDate: expect.any(Object) },
      ]);
    });
  });

  describe('findAll', () => {
    it('should throw BadRequestException if dateType is invalid', async () => {
      await expect(
        service.findAll({
          companyId: 'comp-1',
          dateType: 'invalidDate' as any,
          page: '1',
          limit: '10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should fetch data grouped by due date', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        receivableRow('2026-08-05T00:00:00.000Z'),
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'dueDate',
        page: '1',
        limit: '10',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].transactions).toHaveLength(1);
    });

    it('should group an installment with a time component on its own day', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        receivableRow('2026-08-05T03:00:00.000Z'),
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'dueDate',
        page: '1',
        limit: '10',
      });

      expect(result.data[0].date.toISOString()).toBe(
        '2026-08-05T00:00:00.000Z',
      );
      expect(result.data[0].transactions).toHaveLength(1);
    });

    it('should place a provisioned installment by provisionDate when grouping by payment date', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        receivableRow('2026-08-30T00:00:00.000Z', {
          status: 'PROVISIONED',
          paidDate: null,
          provisionDate: new Date('2026-08-05T00:00:00.000Z'),
        }),
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'paidDate',
        page: '1',
        limit: '10',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].date.toISOString()).toBe(
        '2026-08-05T00:00:00.000Z',
      );
    });

    it('should order groups by date even when a date exists only in payables', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        receivableRow('2026-08-19T00:00:00.000Z'),
        receivableRow('2026-08-09T00:00:00.000Z'),
        receivableRow('2026-08-01T00:00:00.000Z'),
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([
        payableRow('2026-08-05T00:00:00.000Z'),
      ]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'dueDate',
        page: '1',
        limit: '10',
      });

      expect(result.data.map((group) => group.date.toISOString())).toEqual([
        '2026-08-19T00:00:00.000Z',
        '2026-08-09T00:00:00.000Z',
        '2026-08-05T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ]);
    });

    it('should order groups ascending when sort is asc', async () => {
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        receivableRow('2026-08-01T00:00:00.000Z'),
        receivableRow('2026-08-19T00:00:00.000Z'),
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([
        payableRow('2026-08-05T00:00:00.000Z'),
      ]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'dueDate',
        sort: 'asc',
        page: '1',
        limit: '10',
      });

      expect(result.data.map((group) => group.date.toISOString())).toEqual([
        '2026-08-01T00:00:00.000Z',
        '2026-08-05T00:00:00.000Z',
        '2026-08-19T00:00:00.000Z',
      ]);
    });
  });

  describe('getReceivableDetails', () => {
    it('should return receivable if found', async () => {
      prismaMock.receivable.findUnique.mockResolvedValue({ id: 'rec-1' });
      const result = await service.getReceivableDetails('rec-1');
      expect(result).toEqual({
        id: 'rec-1',
        invoiceType: null,
        pendency: null,
      });
    });

    it('should throw NotFoundException if receivable not found', async () => {
      prismaMock.receivable.findUnique.mockResolvedValue(null);
      await expect(service.getReceivableDetails('rec-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPayableDetails', () => {
    it('should return payable if found', async () => {
      prismaMock.payable.findUnique.mockResolvedValue({ id: 'pay-1' });
      const result = await service.getPayableDetails('pay-1');
      expect(result).toEqual({ id: 'pay-1' });
    });

    it('should throw NotFoundException if payable not found', async () => {
      prismaMock.payable.findUnique.mockResolvedValue(null);
      await expect(service.getPayableDetails('pay-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOverdueAccountsLast7Days', () => {
    it('should return overdue accounts ordered by due date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      prismaMock.receivableInstallment.findMany.mockResolvedValue([
        { dueDate: pastDate },
      ]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([
        { dueDate: pastDate },
      ]);

      const result = await service.getOverdueAccountsLast7Days('comp-1');

      expect(prismaMock.receivableInstallment.findMany).toHaveBeenCalled();
      expect(result.hasOverdue).toBe(true);
      expect(result.count).toBe(2);
    });
  });
});

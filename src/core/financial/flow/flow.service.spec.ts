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
        groupBy: jest.fn(),
      },
      payableInstallment: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
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
        receivables: { expected: 110, totalPaid: 50 },
        payables: { expected: 220, totalPaid: 100 },
      });
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
      prismaMock.receivableInstallment.groupBy.mockResolvedValue([
        { dueDate: new Date() },
      ]);
      prismaMock.payableInstallment.groupBy.mockResolvedValue([
        { dueDate: new Date() },
      ]);

      prismaMock.receivableInstallment.findMany.mockResolvedValue([]);
      prismaMock.payableInstallment.findMany.mockResolvedValue([]);

      const result = await service.findAll({
        companyId: 'comp-1',
        dateType: 'dueDate',
        page: '1',
        limit: '10',
      });

      expect(result.data).toBeDefined();
      expect(prismaMock.receivableInstallment.groupBy).toHaveBeenCalled();
    });
  });

  describe('getReceivableDetails', () => {
    it('should return receivable if found', async () => {
      prismaMock.receivable.findUnique.mockResolvedValue({ id: 'rec-1' });
      const result = await service.getReceivableDetails('rec-1');
      expect(result).toEqual({ id: 'rec-1' });
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

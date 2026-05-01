import { Test, TestingModule } from '@nestjs/testing';
import { BaseTransactionService } from './base-transaction.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException } from '@nestjs/common';

describe('BaseTransactionService', () => {
  let service: BaseTransactionService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      nature: { findFirst: jest.fn() },
      subCategory: { findFirst: jest.fn() },
      receivableInstallment: { update: jest.fn() },
      receivable: { update: jest.fn() },
      payableInstallment: { update: jest.fn() },
      payable: { update: jest.fn() },
      commission: { findMany: jest.fn() },
      $transaction: jest
        .fn()
        .mockImplementation((actions) => Promise.all(actions)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaseTransactionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<BaseTransactionService>(BaseTransactionService);
  });

  describe('validatePaymentDifference', () => {
    it('should throw BadRequestException if nature or category is missing', async () => {
      await expect(
        service.validatePaymentDifference(10, '', 'cat-1', 'receivable'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if nature is not found or inactive', async () => {
      prismaMock.nature.findFirst.mockResolvedValue(null);
      await expect(
        service.validatePaymentDifference(10, 'nat-1', 'cat-1', 'receivable'),
      ).rejects.toThrow('Natureza não encontrada ou inativa.');
    });

    it('should validate correctly for receivable positive difference (01)', async () => {
      prismaMock.nature.findFirst.mockResolvedValue({
        id: 'nat-1',
        level1: '01',
        companyId: 'comp-1',
      });
      prismaMock.subCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        natureId: 'nat-1',
        companyId: 'comp-1',
      });

      await expect(
        service.validatePaymentDifference(10, 'nat-1', 'cat-1', 'receivable'),
      ).resolves.toBeUndefined();
    });

    it('should throw BadRequestException if category does not belong to nature', async () => {
      prismaMock.nature.findFirst.mockResolvedValue({
        id: 'nat-1',
        level1: '01',
        companyId: 'comp-1',
      });
      prismaMock.subCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        natureId: 'nat-2',
        companyId: 'comp-1',
      });

      await expect(
        service.validatePaymentDifference(10, 'nat-1', 'cat-1', 'receivable'),
      ).rejects.toThrow(
        'A categoria selecionada não pertence à natureza escolhida.',
      );
    });
  });

  describe('getActualStatus', () => {
    it('should return OVERDUE if PENDING and past due date', () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      const status = service.getActualStatus({
        id: '1',
        status: 'PENDING',
        dueDate: pastDate,
      });
      expect(status).toBe('OVERDUE');
    });

    it('should return PENDING if PENDING and future due date', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);
      const status = service.getActualStatus({
        id: '2',
        status: 'PENDING',
        dueDate: futureDate,
      });
      expect(status).toBe('PENDING');
    });
  });

  describe('cancelReceivableWithInstallments', () => {
    it('should cancel receivable and pending installments', async () => {
      const receivable: any = {
        id: 'rec-1',
        installments: [
          { id: 'inst-1', status: 'PENDING' },
          { id: 'inst-2', status: 'PAID' },
        ],
      };

      prismaMock.receivableInstallment.update.mockReturnValue('update-inst');
      prismaMock.receivable.update.mockReturnValue('update-rec');

      await service.cancelReceivableWithInstallments(
        receivable,
        'Cancelamento',
      );

      expect(prismaMock.receivableInstallment.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.receivableInstallment.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { status: 'CANCELED' },
      });
      expect(prismaMock.receivable.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({
            status: 'CANCELED',
            cancelReason: 'Cancelamento',
          }),
        }),
      );
      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        'update-inst',
        'update-rec',
      ]);
    });
  });

  describe('reactivateReceivableWithInstallments', () => {
    it('should reactivate receivable and canceled installments', async () => {
      const receivable: any = {
        id: 'rec-1',
        installments: [
          { id: 'inst-1', status: 'CANCELED' },
          { id: 'inst-2', status: 'PAID' },
        ],
      };

      prismaMock.receivableInstallment.update.mockReturnValue('update-inst');
      prismaMock.receivable.update.mockReturnValue('update-rec');

      await service.reactivateReceivableWithInstallments(
        receivable,
        'Reativação',
      );

      expect(prismaMock.receivableInstallment.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.receivableInstallment.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { status: 'PENDING' },
      });
      expect(prismaMock.receivable.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-1' },
          data: expect.objectContaining({
            status: 'PENDING',
            changeReason: 'Reativação',
          }),
        }),
      );
    });
  });

  describe('cancelRelatedFinancials', () => {
    it('should cancel related commissions, down payments, and deliveries', async () => {
      prismaMock.commission.findMany.mockResolvedValue([
        { payable: { id: 'pay-1', installments: [] } },
      ]);
      prismaMock.receivable.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'rec-1', installments: [] }]);
      prismaMock.payable.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'pay-2', installments: [] }]);

      await service.cancelRelatedFinancials('quote-1');

      expect(prismaMock.commission.findMany).toHaveBeenCalled();
      expect(prismaMock.receivable.findMany).toHaveBeenCalled();
      expect(prismaMock.payable.findMany).toHaveBeenCalled();
    });
  });
});

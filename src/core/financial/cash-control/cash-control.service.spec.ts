import { Test, TestingModule } from '@nestjs/testing';
import { CashControlService } from './cash-control.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';
const mockCashRegisterId = 'cash-uuid-456';
const mockBankAccountId = 'bank-uuid-789';

const createMockPrismaService = () => ({
  cashRegister: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  bankAccountCashControl: {
    findMany: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('CashControlService', () => {
  let service: CashControlService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashControlService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CashControlService>(CashControlService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findAllQuantity ──────────────────────────────────────────────

  describe('findAllQuantity', () => {
    it('should return status counts and total', async () => {
      prisma.cashRegister.groupBy.mockResolvedValue([
        { status: 'OPEN', _count: 3 },
        { status: 'CLOSED', _count: 7 },
      ]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.OPEN).toBe(3);
      expect(result.CLOSED).toBe(7);
      expect(result.TOTAL).toBe(10);
    });

    it('should handle empty results', async () => {
      prisma.cashRegister.groupBy.mockResolvedValue([]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.OPEN).toBe(0);
      expect(result.CLOSED).toBe(0);
      expect(result.TOTAL).toBe(0);
    });
  });

  // ─── openCashRegister ─────────────────────────────────────────────

  describe('openCashRegister', () => {
    const openDto = {
      companyId: mockCompanyId,
      bankAccountId: mockBankAccountId,
      openingDate: '2026-03-09',
    };

    it('should throw when a register already exists for this date+account', async () => {
      prisma.cashRegister.findFirst.mockResolvedValue({
        id: 'existing-register',
      });

      await expect(service.openCashRegister(openDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw when no payment method config exists', async () => {
      prisma.cashRegister.findFirst
        .mockResolvedValueOnce(null) // no existing register
        .mockResolvedValueOnce(null); // no last closed
      prisma.bankAccountCashControl.findMany.mockResolvedValue([]);

      await expect(service.openCashRegister(openDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create register with opening balance from last closed', async () => {
      prisma.cashRegister.findFirst
        .mockResolvedValueOnce(null) // no existing register
        .mockResolvedValueOnce({ closingBalance: 5000 }); // last closed
      prisma.bankAccountCashControl.findMany.mockResolvedValue([
        { id: 'ctrl-1' },
      ]);
      prisma.cashRegister.create.mockResolvedValue({
        id: mockCashRegisterId,
        openingBalance: 5000,
        status: 'OPEN',
      });

      const result = await service.openCashRegister(openDto as any);

      expect(result.openingBalance).toBe(5000);
      expect(prisma.cashRegister.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openingBalance: 5000 }),
        }),
      );
    });

    it('should default opening balance to 0 when no previous register', async () => {
      prisma.cashRegister.findFirst
        .mockResolvedValueOnce(null) // no existing
        .mockResolvedValueOnce(null); // no previous closed
      prisma.bankAccountCashControl.findMany.mockResolvedValue([
        { id: 'ctrl-1' },
      ]);
      prisma.cashRegister.create.mockResolvedValue({
        id: mockCashRegisterId,
        openingBalance: 0,
      });

      await service.openCashRegister(openDto as any);

      expect(prisma.cashRegister.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openingBalance: 0 }),
        }),
      );
    });
  });

  // ─── closeCashRegister ────────────────────────────────────────────

  describe('closeCashRegister', () => {
    it('should throw when register not found or already closed', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue(null);

      await expect(
        service.closeCashRegister({
          cashRegisterId: 'invalid',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when register is already CLOSED', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'CLOSED',
        transactions: [],
      });

      await expect(
        service.closeCashRegister({
          cashRegisterId: mockCashRegisterId,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate closingBalance correctly', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'OPEN',
        openingBalance: 1000,
        retroactive: 50,
        transactions: [
          { type: 'INCOME', amount: 500 },
          { type: 'INCOME', amount: 300 },
          { type: 'OUTCOME', amount: 200 },
        ],
      });
      prisma.cashRegister.update.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'CLOSED',
        closingBalance: 1650,
      });

      await service.closeCashRegister({
        cashRegisterId: mockCashRegisterId,
        notes: 'End of day',
      } as any);

      // closingBalance = 1000 + 800 - 200 + 50 = 1650
      expect(prisma.cashRegister.update).toHaveBeenCalledWith({
        where: { id: mockCashRegisterId },
        data: expect.objectContaining({
          status: 'CLOSED',
          closingBalance: 1650,
          totalIncomes: 800,
          totalOutcomes: 200,
        }),
      });
    });
  });

  // ─── editCashRegister ─────────────────────────────────────────────

  describe('editCashRegister', () => {
    it('should throw when register not found or closed', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue(null);

      await expect(
        service.editCashRegister({
          cashRegisterId: 'invalid',
          type: 'INCOME',
          amount: 100,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when amount is 0 or negative', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'OPEN',
        totalIncomes: 0,
        totalOutcomes: 0,
      });

      await expect(
        service.editCashRegister({
          cashRegisterId: mockCashRegisterId,
          type: 'INCOME',
          amount: 0,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create transaction and update totals for INCOME', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'OPEN',
        totalIncomes: 100,
        totalOutcomes: 0,
      });
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.editCashRegister({
        cashRegisterId: mockCashRegisterId,
        type: 'INCOME',
        amount: 250,
        reason: 'Manual entry',
      } as any);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // ─── findOneCashRegister ──────────────────────────────────────────

  describe('findOneCashRegister', () => {
    it('should throw NotFoundException when not found', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue(null);

      await expect(service.findOneCashRegister('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return formatted register with transactions', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'OPEN',
        openingDate: new Date('2026-03-09'),
        closingDate: null,
        openingBalance: 1000,
        totalIncomes: 500,
        totalOutcomes: 200,
        retroactive: 0,
        closingBalance: null,
        bankAccount: {
          name: 'Main Account',
          bank: { name: 'Bank ABC' },
        },
        transactions: [
          {
            id: 'tx-1',
            type: 'INCOME',
            amount: 500,
            reason: 'Sale',
            transactionDate: new Date('2026-03-09'),
          },
        ],
      });

      const result = await service.findOneCashRegister(mockCashRegisterId);

      expect(result.id).toBe(mockCashRegisterId);
      expect(result.bankAccount.name).toBe('Main Account');
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe('INCOME');
    });
  });

  // ─── reopenCashRegister ───────────────────────────────────────────

  describe('reopenCashRegister', () => {
    it('should throw NotFoundException when not found', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue(null);

      await expect(service.reopenCashRegister('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update status to OPEN', async () => {
      prisma.cashRegister.findUnique.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'CLOSED',
      });
      prisma.cashRegister.update.mockResolvedValue({
        id: mockCashRegisterId,
        status: 'OPEN',
      });

      await service.reopenCashRegister(mockCashRegisterId);

      expect(prisma.cashRegister.update).toHaveBeenCalledWith({
        where: { id: mockCashRegisterId },
        data: { status: 'OPEN' },
      });
    });
  });

  // ─── transferFunds ────────────────────────────────────────────────

  describe('transferFunds', () => {
    it('should throw when source register not found or closed', async () => {
      prisma.cashRegister.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.transferFunds({
          sourceBankAccountId: 'src-bank',
          targetBankAccountId: 'tgt-bank',
          amount: 100,
          transferMethod: 'PIX',
          transferDate: '2026-03-09',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create target register if it does not exist', async () => {
      prisma.cashRegister.findFirst
        .mockResolvedValueOnce({
          id: 'src-cash',
          status: 'OPEN',
          companyId: mockCompanyId,
          totalOutcomes: 0,
        })
        .mockResolvedValueOnce(null); // no target
      prisma.cashRegister.create.mockResolvedValue({
        id: 'new-tgt-cash',
        totalIncomes: 0,
      });
      prisma.$transaction.mockResolvedValue([]);

      await service.transferFunds({
        sourceBankAccountId: 'src-bank',
        targetBankAccountId: 'tgt-bank',
        amount: 500,
        transferMethod: 'PIX',
        transferDate: '2026-03-09',
      } as any);

      expect(prisma.cashRegister.create).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});

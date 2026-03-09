import { Test, TestingModule } from '@nestjs/testing';
import { ReceivableService } from './receivable.service';
import { PrismaService } from 'nestjs-prisma';
import { FinancialHistoryService } from '../history/history.service';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';
const mockReceivableId = 'receivable-uuid-456';
const mockInstallmentId = 'installment-uuid-789';
const mockClientId = 'client-uuid-101';
const mockUserId = 'user-uuid-202';
const mockUserName = 'Test User';
const mockBankAccountId = 'bank-uuid-303';
const mockNatureId = 'nature-uuid-404';
const mockSubCategoryId = 'subcategory-uuid-505';
const mockPaymentConditionId = 'payment-cond-uuid-606';

const createMockPrismaService = () => ({
  receivable: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  receivableInstallment: {
    create: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  receivableHistory: {
    deleteMany: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
  },
  bankAccountCashControl: {
    findFirst: jest.fn(),
  },
  cashRegister: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    create: jest.fn(),
  },
  client: {
    findUnique: jest.fn(),
  },
  nature: {
    findFirst: jest.fn(),
  },
  subCategory: {
    findFirst: jest.fn(),
  },
  payable: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  payableInstallment: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

const createMockHistoryService = () => ({
  createReceivableHistory: jest.fn().mockResolvedValue(null),
  getReceivableHistory: jest.fn(),
  getCreateDescription: jest.fn().mockReturnValue('Título criado'),
  getUpdateTitleDescription: jest.fn().mockReturnValue('Título atualizado'),
  getCancelDescription: jest.fn().mockReturnValue('Título cancelado'),
  getUndoCancelDescription: jest
    .fn()
    .mockReturnValue('Cancelamento desfeito - título reativado'),
  getPayInstallmentDescription: jest
    .fn()
    .mockReturnValue('Parcela 1 paga'),
  getUndoPaymentDescription: jest
    .fn()
    .mockReturnValue('Pagamento da parcela 1 desfeito'),
  getUpdateInstallmentsDescription: jest
    .fn()
    .mockReturnValue('Parcelas alteradas'),
});

describe('ReceivableService', () => {
  let service: ReceivableService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let historyService: ReturnType<typeof createMockHistoryService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    historyService = createMockHistoryService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceivableService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinancialHistoryService, useValue: historyService },
      ],
    }).compile();

    service = module.get<ReceivableService>(ReceivableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── getActualStatus (private, tested via findOne) ───────────────

  describe('dynamic status via findOne', () => {
    const baseReceivable = {
      id: mockReceivableId,
      companyId: mockCompanyId,
      clientId: mockClientId,
      status: 'PENDING',
      client: { id: mockClientId, name: 'Test Client' },
      nature: { id: mockNatureId },
      subCategory: { id: mockSubCategoryId },
    };

    it('should mark PENDING installment as OVERDUE when past due', async () => {
      const pastDate = new Date('2025-01-01');
      prisma.receivable.findUnique.mockResolvedValue({
        ...baseReceivable,
        installments: [
          {
            id: mockInstallmentId,
            status: 'PENDING',
            dueDate: pastDate,
            installmentNumber: 1,
            paymentCondition: null,
            bankAccount: null,
          },
        ],
      });

      const result = await service.findOne(mockReceivableId);

      expect(result.installments[0].status).toBe('OVERDUE');
    });

    it('should keep PENDING status when due date is in the future', async () => {
      const futureDate = new Date('2030-12-31');
      prisma.receivable.findUnique.mockResolvedValue({
        ...baseReceivable,
        installments: [
          {
            id: mockInstallmentId,
            status: 'PENDING',
            dueDate: futureDate,
            installmentNumber: 1,
            paymentCondition: null,
            bankAccount: null,
          },
        ],
      });

      const result = await service.findOne(mockReceivableId);

      expect(result.installments[0].status).toBe('PENDING');
    });

    it('should keep PAID status regardless of due date', async () => {
      const pastDate = new Date('2025-01-01');
      prisma.receivable.findUnique.mockResolvedValue({
        ...baseReceivable,
        installments: [
          {
            id: mockInstallmentId,
            status: 'PAID',
            dueDate: pastDate,
            installmentNumber: 1,
            paymentCondition: null,
            bankAccount: null,
          },
        ],
      });

      const result = await service.findOne(mockReceivableId);

      expect(result.installments[0].status).toBe('PAID');
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should throw NotFoundException when receivable not found', async () => {
      prisma.receivable.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return receivable with dynamic installment statuses', async () => {
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'PENDING',
        installments: [
          {
            id: 'inst-1',
            status: 'PAID',
            dueDate: new Date('2025-01-01'),
            installmentNumber: 1,
            paymentCondition: null,
            bankAccount: null,
          },
        ],
        client: { id: mockClientId },
        nature: { id: mockNatureId },
        subCategory: null,
      });

      const result = await service.findOne(mockReceivableId);

      expect(result.id).toBe(mockReceivableId);
      expect(result.installments[0].status).toBe('PAID');
    });
  });

  // ─── create ───────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      companyId: mockCompanyId,
      clientId: mockClientId,
      description: 'Test Receivable',
      referenceDate: '2026-03-01',
      natureId: mockNatureId,
      subCategoryId: mockSubCategoryId,
      bankAccountId: mockBankAccountId,
      installments: [
        {
          amount: 500,
          dueDate: '2026-04-01',
          additionalFee: 0,
          status: 'PENDING',
        },
        {
          amount: 500,
          dueDate: '2026-05-01',
          additionalFee: 0,
          status: 'PENDING',
        },
      ],
    };

    it('should throw error when no installments provided', async () => {
      const emptyDto = { ...createDto, installments: [] };

      await expect(
        service.create(emptyDto as any, mockUserId, mockUserName),
      ).rejects.toThrow('At least one installment is required.');
    });

    it('should create receivable with installments via transaction', async () => {
      const mockCreatedReceivable = {
        id: mockReceivableId,
        totalAmount: 1000,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          receivable: {
            create: jest.fn().mockResolvedValue(mockCreatedReceivable),
            findUnique: jest.fn(),
          },
          receivableInstallment: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
            findMany: jest.fn().mockResolvedValue([
              { id: 'inst-1', installmentNumber: 1, status: 'PENDING', bankAccountId: mockBankAccountId },
              { id: 'inst-2', installmentNumber: 2, status: 'PENDING', bankAccountId: mockBankAccountId },
            ]),
          },
          bankAccount: {
            findFirst: jest.fn(),
          },
          cashRegister: {
            findFirst: jest.fn(),
          },
          transaction: {
            create: jest.fn(),
          },
        };
        return callback(tx);
      });

      // Mock updateReceivableStatus (called after transaction)
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        installments: [],
      });
      prisma.receivableInstallment.findMany.mockResolvedValue([
        { status: 'PENDING' },
        { status: 'PENDING' },
      ]);

      prisma.client.findUnique.mockResolvedValue({ name: 'Test Client' });

      const result = await service.create(
        createDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.id).toBe(mockReceivableId);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should create history record when userId provided', async () => {
      const mockCreatedReceivable = {
        id: mockReceivableId,
        totalAmount: 1000,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          receivable: { create: jest.fn().mockResolvedValue(mockCreatedReceivable) },
          receivableInstallment: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([
              { id: 'inst-1', installmentNumber: 1, status: 'PENDING', bankAccountId: mockBankAccountId },
            ]),
          },
          bankAccount: { findFirst: jest.fn() },
          cashRegister: { findFirst: jest.fn() },
          transaction: { create: jest.fn() },
        };
        return callback(tx);
      });

      prisma.receivableInstallment.findMany.mockResolvedValue([
        { status: 'PENDING' },
      ]);
      prisma.client.findUnique.mockResolvedValue({ name: 'Test Client' });

      await service.create(
        { ...createDto, installments: [createDto.installments[0]] } as any,
        mockUserId,
        mockUserName,
      );

      expect(historyService.createReceivableHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          receivableId: mockReceivableId,
          action: 'CREATE',
        }),
      );
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────

  describe('cancel', () => {
    const cancelDto = {
      cancelReason: 'Duplicate entry',
      cancelNotes: 'Merged with another',
    };

    it('should return undefined when receivable is already CANCELED (error swallowed)', async () => {
      // NOTE: cancel() catches errors without rethrowing — this is a known tech debt
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'CANCELED',
        installments: [],
        client: {},
        nature: {},
        subCategory: null,
      });

      const result = await service.cancel(
        mockReceivableId,
        cancelDto as any,
        mockUserId,
      );

      // Method swallows errors — returns undefined instead of throwing
      expect(result).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should cancel receivable and PENDING installments', async () => {
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'PENDING',
        quotationId: null,
        financialType: null,
        installments: [
          { id: 'inst-1', status: 'PENDING', dueDate: new Date('2030-01-01') },
          { id: 'inst-2', status: 'PAID', dueDate: new Date('2025-01-01') },
        ],
        client: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      const result = await service.cancel(
        mockReceivableId,
        cancelDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.message).toBe('Conta a receber cancelada com sucesso.');
      expect(prisma.$transaction).toHaveBeenCalled();
      // Only PENDING installments should be in the update batch
      const txArgs = prisma.$transaction.mock.calls[0][0];
      // First item is the installment update, last is the receivable update
      expect(txArgs.length).toBe(2); // 1 PENDING installment + 1 receivable update
    });

    it('should record history when userId provided', async () => {
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'PENDING',
        quotationId: null,
        financialType: null,
        installments: [],
        client: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      await service.cancel(
        mockReceivableId,
        cancelDto as any,
        mockUserId,
        mockUserName,
      );

      expect(historyService.createReceivableHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CANCEL',
          metadata: expect.objectContaining({
            cancelReason: 'Duplicate entry',
          }),
        }),
      );
    });
  });

  // ─── undoCancel ───────────────────────────────────────────────────

  describe('undoCancel', () => {
    const undoDto = {
      undoCancelReason: 'Was not a duplicate',
      undoCancelNotes: 'Re-opening',
    };

    it('should throw BadRequestException when not CANCELED', async () => {
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'PENDING',
        installments: [],
        client: {},
        nature: {},
        subCategory: null,
      });

      await expect(
        service.undoCancel(mockReceivableId, undoDto as any, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should revert CANCELED installments to PENDING', async () => {
      prisma.receivable.findUnique.mockResolvedValue({
        id: mockReceivableId,
        status: 'CANCELED',
        quotationId: null,
        financialType: null,
        installments: [
          { id: 'inst-1', status: 'CANCELED', dueDate: new Date('2030-01-01') },
          { id: 'inst-2', status: 'PAID', dueDate: new Date('2025-01-01') },
        ],
        client: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      const result = await service.undoCancel(
        mockReceivableId,
        undoDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.message).toBe(
        'Cancelamento da conta a receber desfeito com sucesso.',
      );
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete installments, history, then receivable', async () => {
      prisma.receivableInstallment.deleteMany.mockResolvedValue({ count: 2 });
      prisma.receivableHistory.deleteMany.mockResolvedValue({ count: 1 });
      prisma.receivable.delete.mockResolvedValue({
        id: mockReceivableId,
      });

      const result = await service.remove(mockReceivableId);

      expect(prisma.receivableInstallment.deleteMany).toHaveBeenCalledWith({
        where: { receivableId: mockReceivableId },
      });
      expect(prisma.receivableHistory.deleteMany).toHaveBeenCalledWith({
        where: { receivableId: mockReceivableId },
      });
      expect(prisma.receivable.delete).toHaveBeenCalledWith({
        where: { id: mockReceivableId },
      });
      expect(result.id).toBe(mockReceivableId);
    });
  });

  // ─── count ────────────────────────────────────────────────────────

  describe('count', () => {
    it('should return receivable count', async () => {
      prisma.receivable.count.mockResolvedValue(42);

      const result = await service.count();

      expect(result).toBe(42);
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should delegate to historyService', async () => {
      const mockHistory = { total: 3, history: [] };
      historyService.getReceivableHistory.mockResolvedValue(mockHistory);

      const result = await service.getHistory(mockReceivableId);

      expect(result).toEqual(mockHistory);
      expect(historyService.getReceivableHistory).toHaveBeenCalledWith(
        mockReceivableId,
      );
    });
  });

  // ─── payInstallment ───────────────────────────────────────────────

  describe('payInstallment', () => {
    const payDto = {
      paymentConditionId: mockPaymentConditionId,
      bankAccountId: mockBankAccountId,
      amount: 500,
      paidDate: '2026-03-15',
      difference: 0,
      differenceNatureId: null,
      differenceCategoryId: null,
    };

    it('should throw NotFoundException when installment not found', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue(null);

      await expect(
        service.payInstallment('invalid-id', payDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when nature/category not configured', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        receivable: { natureId: null, subCategoryId: null },
      });

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when installment status is not PENDING or PROVISIONED', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PAID',
        receivable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when difference has no nature/category', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        receivable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });

      const dtoWithDiff = {
        ...payDto,
        difference: -50,
        differenceNatureId: null,
        differenceCategoryId: null,
      };

      await expect(
        service.payInstallment(mockInstallmentId, dtoWithDiff as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when bank account config not found', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        receivable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });
      prisma.bankAccountCashControl.findFirst.mockResolvedValue(null);

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should pay installment successfully with PAID status', async () => {
      prisma.receivableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        installmentNumber: 1,
        receivableId: mockReceivableId,
        receivable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });
      prisma.bankAccountCashControl.findFirst.mockResolvedValue({
        bankAccountId: mockBankAccountId,
        incomeType: 'INCOME',
      });

      const mockUpdatedInstallment = {
        id: mockInstallmentId,
        status: 'PAID',
        paidAmount: 500,
        installmentNumber: 1,
        receivableId: mockReceivableId,
      };

      // payInstallment calls $transaction (main), then compensateInstallment calls $transaction again
      prisma.$transaction
        .mockImplementationOnce(async (callback) => {
          // Main payInstallment transaction
          const tx = {
            receivableInstallment: {
              update: jest.fn().mockResolvedValue(mockUpdatedInstallment),
            },
            cashRegister: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'cash-1',
                bankAccountId: mockBankAccountId,
              }),
              update: jest.fn().mockResolvedValue({}),
            },
            transaction: {
              create: jest.fn().mockResolvedValue({}),
            },
            receivable: {
              findUnique: jest.fn(),
            },
          };
          return callback(tx);
        })
        .mockImplementationOnce(async (callback) => {
          // compensateInstallment transaction
          const tx = {
            receivableInstallment: {
              findFirst: jest.fn().mockResolvedValue({
                id: mockInstallmentId,
                paidAmount: 500,
                bankAccountId: mockBankAccountId,
              }),
              update: jest.fn().mockResolvedValue({}),
            },
            cashRegister: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'cash-1',
              }),
              update: jest.fn().mockResolvedValue({}),
            },
            transaction: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return callback(tx);
        });

      // updateReceivableStatus mocks
      prisma.receivableInstallment.findMany.mockResolvedValue([
        { status: 'PAID' },
      ]);
      prisma.receivable.update.mockResolvedValue({});

      // Mock for the final findUnique to get updated installment details (line 1010 of source)
      prisma.receivableInstallment.findUnique.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PAID',
        paidAmount: 500,
        amount: 500,
        installmentNumber: 1,
        receivableId: mockReceivableId,
        dueDate: new Date('2026-04-01'),
        paidDate: new Date('2026-03-15'),
        paymentConditionId: mockPaymentConditionId,
        paymentCondition: { id: mockPaymentConditionId, name: 'PIX' },
        bankAccountId: mockBankAccountId,
        bankAccount: { id: mockBankAccountId, name: 'Main Account' },
      });

      const result = await service.payInstallment(
        mockInstallmentId,
        payDto as any,
        mockUserId,
        mockUserName,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result.message).toBe('Parcela paga com sucesso.');
    });
  });
});

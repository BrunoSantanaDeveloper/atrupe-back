import { Test, TestingModule } from '@nestjs/testing';
import { PayableService } from './payable.service';
import { PrismaService } from 'nestjs-prisma';
import { FinancialHistoryService } from '../history/history.service';
import { BaseTransactionService } from '../utils/base-transaction.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';
const mockPayableId = 'payable-uuid-456';
const mockInstallmentId = 'installment-uuid-789';
const mockSupplierId = 'supplier-uuid-101';
const mockUserId = 'user-uuid-202';
const mockUserName = 'Test User';
const mockBankAccountId = 'bank-uuid-303';
const mockNatureId = 'nature-uuid-404';
const mockSubCategoryId = 'subcategory-uuid-505';
const mockPaymentConditionId = 'payment-cond-uuid-606';

// Os cadastros citados no corpo são da empresa, salvo quando o teste diz
// o contrário: o count responde quantos ids foram consultados
const allFound = () =>
  jest.fn(async ({ where }: any) => where?.id?.in?.length ?? 0);

const createMockPrismaService = () => ({
  pendingSale: { findFirst: jest.fn().mockResolvedValue(null) },
  payable: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  payableInstallment: {
    create: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  payableHistory: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  bankAccount: {
    count: allFound(),
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
  supplier: {
    count: allFound(),
    findUnique: jest.fn(),
  },
  employee: {
    count: allFound(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
  client: { count: allFound() },
  nature: { count: allFound() },
  subCategory: { count: allFound() },
  paymentCondition: { count: allFound() },
});

const createMockHistoryService = () => ({
  createPayableHistory: jest.fn().mockResolvedValue(null),
  getPayableHistory: jest.fn(),
  getCreateDescription: jest.fn().mockReturnValue('Título criado'),
  getUpdateTitleDescription: jest.fn().mockReturnValue('Título atualizado'),
  getCancelDescription: jest.fn().mockReturnValue('Título cancelado'),
  getUndoCancelDescription: jest
    .fn()
    .mockReturnValue('Cancelamento desfeito - título reativado'),
  getPayInstallmentDescription: jest.fn().mockReturnValue('Parcela 1 paga'),
  getUndoPaymentDescription: jest
    .fn()
    .mockReturnValue('Pagamento da parcela 1 desfeito'),
  getUpdateInstallmentsDescription: jest
    .fn()
    .mockReturnValue('Parcelas alteradas'),
});

const createMockBaseService = () => ({
  getActualStatus: jest.fn((inst) => inst.status),
  applyDynamicStatus: jest.fn((inst) => inst),
  cancelRelatedFinancials: jest.fn(),
  reactivateRelatedFinancials: jest.fn(),
  validatePaymentDifference: jest.fn(),
});

describe('PayableService', () => {
  let service: PayableService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let historyService: ReturnType<typeof createMockHistoryService>;
  let baseService: ReturnType<typeof createMockBaseService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    historyService = createMockHistoryService();
    baseService = createMockBaseService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayableService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinancialHistoryService, useValue: historyService },
        { provide: BaseTransactionService, useValue: baseService },
      ],
    }).compile();

    service = module.get<PayableService>(PayableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ───────────────────────────────────────────────────────

  describe('create', () => {
    const createDto = {
      companyId: mockCompanyId,
      supplierId: mockSupplierId,
      description: 'Test Payable',
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

    it('recusa supplier de outra empresa, antes de gravar', async () => {
      prisma.supplier.count.mockResolvedValueOnce(0);

      await expect(
        service.create(createDto as any, mockUserId, mockUserName),
      ).rejects.toThrow(new NotFoundException('Fornecedor não encontrado.'));
      expect(prisma.supplier.count).toHaveBeenCalledWith({
        where: { id: { in: [mockSupplierId] }, companyId: mockCompanyId },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw error when no installments provided', async () => {
      const emptyDto = { ...createDto, installments: [] };

      await expect(
        service.create(emptyDto as any, mockUserId, mockUserName),
      ).rejects.toThrow('At least one installment is required.');
    });

    it('should create payable with installments via transaction', async () => {
      const mockCreatedPayable = {
        id: mockPayableId,
        totalAmount: 1000,
      };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          payable: {
            create: jest.fn().mockResolvedValue(mockCreatedPayable),
            update: jest
              .fn()
              .mockResolvedValue({ ...mockCreatedPayable, status: 'PENDING' }),
          },
          payableInstallment: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'inst-1',
                installmentNumber: 1,
                status: 'PENDING',
                bankAccountId: mockBankAccountId,
              },
              {
                id: 'inst-2',
                installmentNumber: 2,
                status: 'PENDING',
                bankAccountId: mockBankAccountId,
              },
            ]),
          },
          payableHistory: { create: jest.fn() },
          bankAccount: { findFirst: jest.fn() },
          cashRegister: { findFirst: jest.fn() },
          transaction: { create: jest.fn() },
          supplier: {
            findUnique: jest.fn().mockResolvedValue({ name: 'Test Supplier' }),
          },
          employee: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      });

      prisma.payableInstallment.findMany.mockResolvedValue([
        { status: 'PENDING' },
        { status: 'PENDING' },
      ]);
      prisma.supplier.findUnique.mockResolvedValue({ name: 'Test Supplier' });

      const result = await service.create(
        createDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.id).toBe(mockPayableId);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should create history record when userId provided', async () => {
      const mockCreatedPayable = {
        id: mockPayableId,
        totalAmount: 1000,
      };

      let capturedHistory: any;
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          payable: {
            create: jest.fn().mockResolvedValue(mockCreatedPayable),
            update: jest
              .fn()
              .mockResolvedValue({ ...mockCreatedPayable, status: 'PENDING' }),
          },
          payableInstallment: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'inst-1',
                installmentNumber: 1,
                status: 'PENDING',
                bankAccountId: mockBankAccountId,
              },
            ]),
          },
          payableHistory: {
            create: jest.fn().mockImplementation((args) => {
              capturedHistory = args.data;
              return { id: 'history-1' };
            }),
          },
          bankAccount: { findFirst: jest.fn() },
          cashRegister: { findFirst: jest.fn() },
          transaction: { create: jest.fn() },
          supplier: {
            findUnique: jest.fn().mockResolvedValue({ name: 'Test Supplier' }),
          },
          employee: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      });

      prisma.payableInstallment.findMany.mockResolvedValue([
        { status: 'PENDING' },
      ]);
      prisma.supplier.findUnique.mockResolvedValue({ name: 'Test Supplier' });

      await service.create(
        { ...createDto, installments: [createDto.installments[0]] } as any,
        mockUserId,
        mockUserName,
      );

      expect(capturedHistory).toBeDefined();
      expect(capturedHistory).toEqual(
        expect.objectContaining({
          payableId: mockPayableId,
          action: 'CREATE',
          createdBy: mockUserId,
        }),
      );
    });

    it('should sanitize empty supplierId to null', async () => {
      const dtoWithEmptySupplier = {
        ...createDto,
        supplierId: '',
        installments: [createDto.installments[0]],
      };

      let capturedData: any;
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          payable: {
            create: jest.fn().mockImplementation((args) => {
              capturedData = args.data;
              return { id: mockPayableId, totalAmount: 500 };
            }),
            update: jest
              .fn()
              .mockResolvedValue({ id: mockPayableId, status: 'PENDING' }),
          },
          payableInstallment: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'inst-1',
                installmentNumber: 1,
                status: 'PENDING',
                bankAccountId: mockBankAccountId,
              },
            ]),
          },
          payableHistory: { create: jest.fn() },
          bankAccount: { findFirst: jest.fn() },
          cashRegister: { findFirst: jest.fn() },
          transaction: { create: jest.fn() },
          supplier: { findUnique: jest.fn().mockResolvedValue(null) },
          employee: { findUnique: jest.fn().mockResolvedValue(null) },
        };
        return callback(tx);
      });

      prisma.payableInstallment.findMany.mockResolvedValue([
        { status: 'PENDING' },
      ]);

      await service.create(
        dtoWithEmptySupplier as any,
        mockUserId,
        mockUserName,
      );

      expect(capturedData.supplierId).toBeNull();
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should throw NotFoundException when payable not found', async () => {
      prisma.payable.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return payable with dynamic installment statuses', async () => {
      const mockPayable = {
        id: mockPayableId,
        status: 'PENDING',
        installments: [
          {
            id: 'inst-1',
            status: 'PENDING',
            dueDate: new Date('2025-01-01'),
            installmentNumber: 1,
          },
        ],
        supplier: { id: mockSupplierId },
        nature: { id: mockNatureId },
        subCategory: null,
      };
      prisma.payable.findUnique.mockResolvedValue(mockPayable);

      const result = await service.findOne(mockPayableId);

      expect(result.id).toBe(mockPayableId);
      expect(baseService.applyDynamicStatus).toHaveBeenCalled();
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────

  describe('cancel', () => {
    const cancelDto = {
      cancelReason: 'Fornecedor duplicado',
      cancelNotes: 'Merged duplicates',
    };

    it('should throw when payable is already CANCELED', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'CANCELED',
        installments: [],
        supplier: {},
        nature: {},
        subCategory: null,
      });

      await expect(
        service.cancel(mockPayableId, cancelDto as any, mockUserId),
      ).rejects.toThrow('A conta a pagar já foi cancelada.');
    });

    it('should cancel payable and PENDING installments', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'PENDING',
        quotationId: null,
        financialType: null,
        installments: [
          { id: 'inst-1', status: 'PENDING', dueDate: new Date('2030-01-01') },
          { id: 'inst-2', status: 'PAID', dueDate: new Date('2025-01-01') },
        ],
        supplier: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      const result = await service.cancel(
        mockPayableId,
        cancelDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.message).toBe('Conta a pagar cancelada com sucesso.');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should cancel related financials when MAIN type with quotationId', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'PENDING',
        quotationId: 'quot-123',
        financialType: 'MAIN',
        installments: [],
        supplier: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      await service.cancel(
        mockPayableId,
        cancelDto as any,
        mockUserId,
        mockUserName,
      );

      expect(baseService.cancelRelatedFinancials).toHaveBeenCalledWith(
        'quot-123',
      );
    });

    it('should record history when userId provided', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'PENDING',
        quotationId: null,
        financialType: null,
        installments: [],
        supplier: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      await service.cancel(
        mockPayableId,
        cancelDto as any,
        mockUserId,
        mockUserName,
      );

      expect(historyService.createPayableHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CANCEL',
          metadata: expect.objectContaining({
            cancelReason: 'Fornecedor duplicado',
          }),
        }),
      );
    });
  });

  // ─── updateInstallments ───────────────────────────────────────────

  describe('updateInstallments', () => {
    it('recusa parcela de outro título no corpo, antes de gravar', async () => {
      prisma.payableInstallment.count.mockResolvedValueOnce(0);

      await expect(
        service.updateInstallments(mockPayableId, {
          installments: [{ id: 'parcela-de-outro-titulo', amount: 10 }],
        } as any),
      ).rejects.toThrow(new NotFoundException('Parcela não encontrada.'));
      expect(prisma.payableInstallment.count).toHaveBeenCalledWith({
        where: {
          id: { in: ['parcela-de-outro-titulo'] },
          payableId: mockPayableId,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── undoPaymentInstallment ───────────────────────────────────────

  describe('undoPaymentInstallment', () => {
    it('cancela os lançamentos de diferença só da mesma empresa', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        payableId: mockPayableId,
        installmentNumber: 1,
        status: 'PROVISIONED',
        paidAmount: 100,
        paidDate: null,
      });
      // O registro de origem é lido no lado da parcela; os dois lados
      // recebem o cancelamento dos lançamentos de diferença
      const findOriginal = jest.fn().mockResolvedValue({
        description: 'Aluguel',
        companyId: mockCompanyId,
      });
      const tx = {
        payable: { findUnique: findOriginal, updateMany: jest.fn() },
        receivable: { findUnique: findOriginal, updateMany: jest.fn() },
        payableInstallment: { update: jest.fn() },
      };
      prisma.$transaction.mockImplementation((cb: any) => cb(tx));
      jest
        .spyOn(service as any, 'updatePayableStatus')
        .mockResolvedValue(undefined);
      prisma.payableInstallment.findUnique.mockResolvedValue({
        id: mockInstallmentId,
        installmentNumber: 1,
        status: 'PENDING',
        amount: 100,
        paidAmount: null,
        dueDate: new Date('2030-01-01'),
        paidDate: null,
        bankAccount: null,
        paymentCondition: null,
      });

      await service.undoPaymentInstallment(mockInstallmentId);

      const where = {
        companyId: mockCompanyId,
        description: 'Diferença no pagamento da parcela 1 - Aluguel',
        status: { not: 'CANCELED' },
      };
      expect(tx.payable.updateMany).toHaveBeenCalledWith({
        where,
        data: { status: 'CANCELED' },
      });
      expect(tx.receivable.updateMany).toHaveBeenCalledWith({
        where,
        data: { status: 'CANCELED' },
      });
    });
  });

  // ─── undoCancel ───────────────────────────────────────────────────

  describe('undoCancel', () => {
    const undoDto = {
      undoCancelReason: 'Wrong supplier cancelled',
      undoCancelNotes: 'Re-opening',
    };

    it('should throw BadRequestException when not CANCELED', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'PENDING',
        installments: [],
        supplier: {},
        nature: {},
        subCategory: null,
      });

      await expect(
        service.undoCancel(mockPayableId, undoDto as any, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should revert CANCELED installments to PENDING', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'CANCELED',
        quotationId: null,
        financialType: null,
        installments: [
          { id: 'inst-1', status: 'CANCELED', dueDate: new Date('2030-01-01') },
        ],
        supplier: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      const result = await service.undoCancel(
        mockPayableId,
        undoDto as any,
        mockUserId,
        mockUserName,
      );

      expect(result.message).toBe(
        'Cancelamento da conta a pagar desfeito com sucesso.',
      );
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reactivate related financials when MAIN type', async () => {
      prisma.payable.findUnique.mockResolvedValue({
        id: mockPayableId,
        status: 'CANCELED',
        quotationId: 'quot-123',
        financialType: 'MAIN',
        installments: [],
        supplier: {},
        nature: {},
        subCategory: null,
      });
      prisma.$transaction.mockResolvedValue(undefined);

      await service.undoCancel(
        mockPayableId,
        undoDto as any,
        mockUserId,
        mockUserName,
      );

      expect(baseService.reactivateRelatedFinancials).toHaveBeenCalledWith(
        'quot-123',
      );
    });
  });

  // ─── remove ───────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete installments, history, then payable in a transaction', async () => {
      const mockDeleteResult = { id: mockPayableId };

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          payableInstallment: {
            deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          payableHistory: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          payable: {
            delete: jest.fn().mockResolvedValue(mockDeleteResult),
          },
        };
        return callback(tx);
      });

      const result = await service.remove(mockPayableId);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.id).toBe(mockPayableId);
    });
  });

  // ─── count ────────────────────────────────────────────────────────

  describe('count', () => {
    it('should return payable count with companyId filter', async () => {
      prisma.payable.count.mockResolvedValue(15);

      const result = await service.count(mockCompanyId);

      expect(result).toBe(15);
      expect(prisma.payable.count).toHaveBeenCalledWith({
        where: { companyId: mockCompanyId },
      });
    });

    it('should return count without filter when no companyId', async () => {
      prisma.payable.count.mockResolvedValue(42);

      const result = await service.count();

      expect(result).toBe(42);
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

    it('recusa conta bancária de outra empresa: o pagamento cairia no caixa dela', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        payable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
          companyId: mockCompanyId,
        },
      });
      prisma.bankAccount.count.mockResolvedValueOnce(0);

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(
        new NotFoundException('Conta bancária não encontrada.'),
      );
      expect(prisma.bankAccount.count).toHaveBeenCalledWith({
        where: { id: { in: [mockBankAccountId] }, companyId: mockCompanyId },
      });
      expect(prisma.bankAccountCashControl.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when installment not found', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue(null);

      await expect(
        service.payInstallment('invalid-id', payDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when nature/category not configured', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        payable: { natureId: null, subCategoryId: null },
      });

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when installment status is not PENDING or PROVISIONED', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PAID',
        payable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when bank account config not found', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        payable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });
      prisma.bankAccountCashControl.findFirst.mockResolvedValue(null);

      await expect(
        service.payInstallment(mockInstallmentId, payDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate difference when provided', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        payable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });

      const dtoWithDiff = {
        ...payDto,
        difference: -50,
        differenceNatureId: 'diff-nature',
        differenceCategoryId: 'diff-cat',
      };

      prisma.bankAccountCashControl.findFirst.mockResolvedValue({
        bankAccountId: mockBankAccountId,
        paymentType: 'PAYMENT',
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          payableInstallment: {
            update: jest.fn().mockResolvedValue({
              id: mockInstallmentId,
              status: 'PAID',
              paidAmount: 450,
            }),
            findFirst: jest.fn().mockResolvedValue({
              id: mockInstallmentId,
              paidAmount: 450,
              bankAccountId: mockBankAccountId,
            }),
          },
          payable: {
            findUnique: jest.fn().mockResolvedValue({
              companyId: 'comp-1',
              clientId: 'client-1',
              supplierId: 'supp-1',
              referenceDate: new Date(),
              description: 'Original Payable',
            }),
            create: jest.fn().mockResolvedValue({ id: 'new-pay-1' }),
          },
          receivable: {
            create: jest.fn().mockResolvedValue({ id: 'new-rec-1' }),
          },
          receivableInstallment: {
            create: jest
              .fn()
              .mockResolvedValue({ id: 'new-rec-inst-1', paidAmount: 50 }),
          },
          bankAccount: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ cashControl: true, kind: 'BANK' }),
          },
          cashRegister: {
            findFirst: jest.fn().mockResolvedValue({ id: 'cash-1' }),
            update: jest.fn(),
          },
          transaction: { create: jest.fn() },
        };
        return callback(tx);
      });

      prisma.payableInstallment.findMany.mockResolvedValue([
        { status: 'PAID' },
      ]);
      prisma.payable.update.mockResolvedValue({});
      prisma.payableInstallment.findUnique.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PAID',
        paidAmount: 450,
        amount: 500,
        installmentNumber: 1,
        payableId: mockPayableId,
        dueDate: new Date(),
        paidDate: new Date(),
        paymentCondition: { id: mockPaymentConditionId },
        bankAccount: { id: mockBankAccountId },
      });

      await service.payInstallment(
        mockInstallmentId,
        dtoWithDiff as any,
        mockUserId,
        mockUserName,
      );

      expect(baseService.validatePaymentDifference).toHaveBeenCalledWith(
        -50,
        'diff-nature',
        'diff-cat',
        'payable',
      );
    });

    it('should pay installment successfully with PAID status', async () => {
      prisma.payableInstallment.findFirst.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PENDING',
        installmentNumber: 1,
        payableId: mockPayableId,
        payable: {
          natureId: mockNatureId,
          subCategoryId: mockSubCategoryId,
        },
      });
      prisma.bankAccountCashControl.findFirst.mockResolvedValue({
        bankAccountId: mockBankAccountId,
        paymentType: 'PAYMENT',
      });

      const mockUpdatedInstallment = {
        id: mockInstallmentId,
        status: 'PAID',
        paidAmount: 500,
        installmentNumber: 1,
        payableId: mockPayableId,
      };

      // Main payInstallment transaction
      prisma.$transaction
        .mockImplementationOnce(async (callback) => {
          const tx = {
            payableInstallment: {
              update: jest.fn().mockResolvedValue(mockUpdatedInstallment),
            },
            payable: { findUnique: jest.fn() },
            bankAccount: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ cashControl: true, kind: 'BANK' }),
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
            receivable: { create: jest.fn() },
            receivableInstallment: { create: jest.fn() },
          };
          return callback(tx);
        })
        // compensateInstallment transaction
        .mockImplementationOnce(async (callback) => {
          const tx = {
            payableInstallment: {
              findFirst: jest.fn().mockResolvedValue({
                id: mockInstallmentId,
                paidAmount: 500,
                bankAccountId: mockBankAccountId,
              }),
              update: jest.fn().mockResolvedValue({}),
            },
            bankAccount: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ cashControl: true, kind: 'BANK' }),
            },
            cashRegister: {
              findFirst: jest.fn().mockResolvedValue({ id: 'cash-1' }),
              update: jest.fn().mockResolvedValue({}),
            },
            transaction: {
              create: jest.fn().mockResolvedValue({}),
            },
          };
          return callback(tx);
        });

      // updatePayableStatus mocks
      prisma.payableInstallment.findMany.mockResolvedValue([
        { status: 'PAID' },
      ]);
      prisma.payable.update.mockResolvedValue({});

      // Payroll lookup (expenseSource check)
      prisma.payable.findUnique.mockResolvedValue({
        expenseSource: 'SUPPLIER',
        financialType: 'MAIN',
        employeeId: null,
        referenceDate: new Date(),
      });

      // Final findUnique for installment details
      prisma.payableInstallment.findUnique.mockResolvedValue({
        id: mockInstallmentId,
        status: 'PAID',
        paidAmount: 500,
        amount: 500,
        installmentNumber: 1,
        payableId: mockPayableId,
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

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.message).toBe('Parcela paga com sucesso.');
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should delegate to historyService', async () => {
      const mockHistory = { total: 3, history: [] };
      historyService.getPayableHistory.mockResolvedValue(mockHistory);

      const result = await service.getHistory(mockPayableId);

      expect(result).toEqual(mockHistory);
      expect(historyService.getPayableHistory).toHaveBeenCalledWith(
        mockPayableId,
      );
    });
  });
});

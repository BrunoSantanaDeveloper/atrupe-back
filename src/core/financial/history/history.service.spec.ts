import { Test, TestingModule } from '@nestjs/testing';
import { FinancialHistoryService } from './history.service';
import { PrismaService } from 'nestjs-prisma';

const mockReceivableId = 'receivable-uuid-123';
const mockPayableId = 'payable-uuid-456';
const mockUserId = 'user-uuid-789';

const createMockPrismaService = () => ({
  receivableHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  payableHistory: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
});

describe('FinancialHistoryService', () => {
  let service: FinancialHistoryService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialHistoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FinancialHistoryService>(FinancialHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── createReceivableHistory ──────────────────────────────────────

  describe('createReceivableHistory', () => {
    const dto = {
      receivableId: mockReceivableId,
      action: 'CREATE',
      description: 'Título criado',
      createdBy: mockUserId,
      createdByName: 'Test User',
    };

    it('should create a receivable history record', async () => {
      const mockHistory = { id: 'hist-1', ...dto };
      prisma.receivableHistory.create.mockResolvedValue(mockHistory);

      const result = await service.createReceivableHistory(dto);

      expect(result).toEqual(mockHistory);
      expect(prisma.receivableHistory.create).toHaveBeenCalledWith({
        data: {
          receivableId: dto.receivableId,
          action: dto.action,
          description: dto.description,
          changes: null,
          metadata: null,
          createdBy: dto.createdBy,
          createdByName: dto.createdByName,
        },
      });
    });

    it('should handle optional changes and metadata', async () => {
      const dtoWithExtra = {
        ...dto,
        changes: { before: { amount: 100 }, after: { amount: 200 } },
        metadata: { clientName: 'Test' },
      };
      prisma.receivableHistory.create.mockResolvedValue({
        id: 'hist-2',
        ...dtoWithExtra,
      });

      await service.createReceivableHistory(dtoWithExtra);

      expect(prisma.receivableHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changes: dtoWithExtra.changes,
          metadata: dtoWithExtra.metadata,
        }),
      });
    });

    it('should return null and not throw on database error', async () => {
      prisma.receivableHistory.create.mockRejectedValue(new Error('DB error'));

      const result = await service.createReceivableHistory(dto);

      expect(result).toBeNull();
    });
  });

  // ─── createPayableHistory ─────────────────────────────────────────

  describe('createPayableHistory', () => {
    const dto = {
      payableId: mockPayableId,
      action: 'CREATE',
      description: 'Título criado',
      createdBy: mockUserId,
    };

    it('should create a payable history record', async () => {
      const mockHistory = { id: 'hist-3', ...dto };
      prisma.payableHistory.create.mockResolvedValue(mockHistory);

      const result = await service.createPayableHistory(dto);

      expect(result).toEqual(mockHistory);
      expect(prisma.payableHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payableId: dto.payableId,
          action: dto.action,
        }),
      });
    });

    it('should return null and not throw on database error', async () => {
      prisma.payableHistory.create.mockRejectedValue(new Error('DB error'));

      const result = await service.createPayableHistory(dto);

      expect(result).toBeNull();
    });
  });

  // ─── getReceivableHistory ─────────────────────────────────────────

  describe('getReceivableHistory', () => {
    it('should return formatted history with total count', async () => {
      const mockHistory = [
        {
          id: 'hist-1',
          action: 'CREATE',
          description: 'Título criado',
          changes: null,
          metadata: { totalAmount: 1000 },
          createdBy: mockUserId,
          createdByName: 'Test User',
          createdAt: new Date('2026-03-01'),
          user: {
            id: mockUserId,
            name: 'Test User',
            email: 'test@test.com',
            avatar: null,
          },
        },
        {
          id: 'hist-2',
          action: 'CANCEL',
          description: 'Título cancelado',
          changes: null,
          metadata: null,
          createdBy: mockUserId,
          createdByName: null,
          createdAt: new Date('2026-03-02'),
          user: {
            id: mockUserId,
            name: 'Test User',
            email: 'test@test.com',
            avatar: null,
          },
        },
      ];
      prisma.receivableHistory.findMany.mockResolvedValue(mockHistory);

      const result = await service.getReceivableHistory(mockReceivableId);

      expect(result.total).toBe(2);
      expect(result.history).toHaveLength(2);
      expect(result.history[0].action).toBe('CREATE');
      // createdByName fallback to user.name when null
      expect(result.history[1].createdByName).toBe('Test User');
    });

    it('should return empty history when none exists', async () => {
      prisma.receivableHistory.findMany.mockResolvedValue([]);

      const result = await service.getReceivableHistory('nonexistent-id');

      expect(result.total).toBe(0);
      expect(result.history).toHaveLength(0);
    });
  });

  // ─── getPayableHistory ────────────────────────────────────────────

  describe('getPayableHistory', () => {
    it('should return formatted payable history', async () => {
      const mockHistory = [
        {
          id: 'hist-5',
          action: 'PAY_INSTALLMENT',
          description: 'Parcela 1 paga',
          changes: null,
          metadata: null,
          createdBy: mockUserId,
          createdByName: 'Admin',
          createdAt: new Date(),
          user: null,
        },
      ];
      prisma.payableHistory.findMany.mockResolvedValue(mockHistory);

      const result = await service.getPayableHistory(mockPayableId);

      expect(result.total).toBe(1);
      expect(result.history[0].action).toBe('PAY_INSTALLMENT');
    });
  });

  // ─── Description helper methods ──────────────────────────────────

  describe('description helpers', () => {
    it('getCreateDescription should return standard text', () => {
      expect(service.getCreateDescription()).toBe('Título criado');
    });

    it('getUpdateTitleDescription should list changed fields', () => {
      const changes = { after: { description: 'New', totalAmount: 500 } };
      const result = service.getUpdateTitleDescription(changes);
      expect(result).toBe('Título atualizado: description, totalAmount');
    });

    it('getUpdateInstallmentsDescription should format counts', () => {
      expect(service.getUpdateInstallmentsDescription(2, 1, 0)).toBe(
        'Parcelas alteradas: 2 adicionada(s), 1 modificada(s)',
      );
      expect(service.getUpdateInstallmentsDescription(0, 0, 3)).toBe(
        'Parcelas alteradas: 3 removida(s)',
      );
    });

    it('getPayInstallmentDescription should include number', () => {
      expect(service.getPayInstallmentDescription(3)).toBe('Parcela 3 paga');
    });

    it('getUndoPaymentDescription should include number', () => {
      expect(service.getUndoPaymentDescription(2)).toBe(
        'Pagamento da parcela 2 desfeito',
      );
    });

    it('getCancelDescription with reason', () => {
      expect(service.getCancelDescription('Duplicado')).toBe(
        'Título cancelado: Duplicado',
      );
    });

    it('getCancelDescription without reason', () => {
      expect(service.getCancelDescription()).toBe('Título cancelado');
    });

    it('getUndoCancelDescription returns standard text', () => {
      expect(service.getUndoCancelDescription()).toBe(
        'Cancelamento desfeito - título reativado',
      );
    });
  });
});

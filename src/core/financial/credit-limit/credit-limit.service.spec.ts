import { Test, TestingModule } from '@nestjs/testing';
import { CreditLimitService } from './credit-limit.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';

const createMockPrismaService = () => ({
  creditLimitDefault: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  creditLimitPaymentCondition: {
    create: jest.fn(),
    update: jest.fn(),
  },
  paymentCondition: {
    findMany: jest.fn(),
  },
  client: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  clientPaymentCondition: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
});

describe('CreditLimitService', () => {
  let service: CreditLimitService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditLimitService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CreditLimitService>(CreditLimitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findOne ──────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return null when no credit limits exist', async () => {
      prisma.creditLimitDefault.findMany.mockResolvedValue([]);

      const result = await service.findOne(mockCompanyId);

      expect(result).toBeNull();
    });

    it('should return formatted person and company limits', async () => {
      prisma.creditLimitDefault.findMany.mockResolvedValue([
        {
          id: 'cl-1',
          type: 'PERSON',
          minValue: 100,
          maxValue: 5000,
          paymentConditions: [
            {
              paymentCondition: { id: 'pc-1', name: 'PIX' },
              isActive: true,
            },
          ],
        },
        {
          id: 'cl-2',
          type: 'COMPANY',
          minValue: 500,
          maxValue: 50000,
          paymentConditions: [],
        },
      ]);
      prisma.paymentCondition.findMany.mockResolvedValue([
        { id: 'pc-1', name: 'PIX' },
        { id: 'pc-2', name: 'Boleto' },
      ]);

      const result = await service.findOne(mockCompanyId);

      expect(result.person.minValue).toBe(100);
      expect(result.person.maxValue).toBe(5000);
      expect(result.company.minValue).toBe(500);
      expect(result.company.maxValue).toBe(50000);
      expect(result.person.paymentMethods.length).toBeGreaterThan(0);
    });

    it('should handle missing type with defaults', async () => {
      prisma.creditLimitDefault.findMany.mockResolvedValue([
        {
          id: 'cl-1',
          type: 'PERSON',
          minValue: 100,
          maxValue: 5000,
          paymentConditions: [],
        },
      ]);
      prisma.paymentCondition.findMany.mockResolvedValue([]);

      const result = await service.findOne(mockCompanyId);

      expect(result.person.minValue).toBe(100);
      // COMPANY type doesn't exist, so formatCreditLimit returns defaults
      expect(result.company.minValue).toBe(0);
      expect(result.company.maxValue).toBe(0);
      expect(result.company.paymentMethods).toHaveLength(0);
    });
  });

  // ─── update ───────────────────────────────────────────────────────

  describe('update', () => {
    it('should update person credit limit', async () => {
      const dto = {
        companyId: mockCompanyId,
        person: {
          minValue: 200,
          maxValue: 10000,
          applyMinValueToAll: false,
          applyMaxValueToAll: false,
          applyPaymentMethodsToAll: false,
        },
      };

      prisma.creditLimitDefault.findFirst.mockResolvedValue({
        id: 'cl-1',
        type: 'PERSON',
        paymentConditions: [],
      });
      prisma.creditLimitDefault.update.mockResolvedValue({
        id: 'cl-1',
        minValue: 200,
        maxValue: 10000,
      });

      const result = await service.update(dto as any);

      expect(result.person).toBeDefined();
      expect(prisma.creditLimitDefault.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when credit limit not found', async () => {
      prisma.creditLimitDefault.findFirst.mockResolvedValue(null);

      await expect(
        service.update({
          companyId: mockCompanyId,
          person: {
            minValue: 100,
            applyMinValueToAll: false,
            applyMaxValueToAll: false,
            applyPaymentMethodsToAll: false,
          },
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should apply global changes when flags are set', async () => {
      const dto = {
        companyId: mockCompanyId,
        person: {
          minValue: 300,
          maxValue: 8000,
          applyMinValueToAll: true,
          applyMaxValueToAll: true,
          applyPaymentMethodsToAll: false,
        },
      };

      prisma.creditLimitDefault.findFirst.mockResolvedValue({
        id: 'cl-1',
        type: 'PERSON',
        paymentConditions: [],
      });
      prisma.creditLimitDefault.update.mockResolvedValue({
        id: 'cl-1',
        minValue: 300,
        maxValue: 8000,
      });
      prisma.client.updateMany.mockResolvedValue({ count: 10 });

      await service.update(dto as any);

      // Should apply to all clients of PERSON type
      expect(prisma.client.updateMany).toHaveBeenCalledTimes(2); // min + max
      expect(prisma.client.updateMany).toHaveBeenCalledWith({
        where: { companyId: mockCompanyId, type: 'PERSON' },
        data: { minValue: 300 },
      });
    });
  });

  // ─── remove ───────────────────────────────────────────────────────

  describe('remove', () => {
    it('should return removal message (placeholder)', () => {
      const result = service.remove(1);
      expect(result).toBe('This action removes a #1 creditLimit');
    });
  });
});

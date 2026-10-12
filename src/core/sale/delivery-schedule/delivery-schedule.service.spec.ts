import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryScheduleService } from './delivery-schedule.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';
const mockDeliveryId = 'delivery-uuid-456';
const mockOrderId = 'order-uuid-789';
const mockQuotationId = 'quotation-uuid-101';

const createMockPrismaService = () => ({
  deliverySchedule: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  order: {
    update: jest.fn(),
  },
  receivable: {
    findMany: jest.fn(),
  },
  payable: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('DeliveryScheduleService', () => {
  let service: DeliveryScheduleService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryScheduleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DeliveryScheduleService>(DeliveryScheduleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a delivery schedule', async () => {
      const dto = {
        quotationId: mockQuotationId,
        companyId: mockCompanyId,
        orderId: mockOrderId,
        status: 'IN_PRODUCTION' as const,
      };
      const mockDelivery = { id: mockDeliveryId, ...dto };
      prisma.deliverySchedule.create.mockResolvedValue(mockDelivery);

      const result = await service.create(
        { ...dto, companyId: 'empresa-forjada' } as any,
        mockCompanyId,
      );

      expect(result.id).toBe(mockDeliveryId);
      // A agenda nasce com a empresa da sessão, mesmo que o corpo traga outra
      expect(prisma.deliverySchedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: mockCompanyId }),
      });
    });
  });

  describe('findOne', () => {
    it('should return a delivery schedule by id', async () => {
      const mockDelivery = { id: mockDeliveryId, status: 'IN_PRODUCTION' };
      prisma.deliverySchedule.findUnique.mockResolvedValue(mockDelivery);

      const result = await service.findOne(mockDeliveryId);

      expect(result.id).toBe(mockDeliveryId);
    });
  });

  describe('update', () => {
    it('should update a delivery schedule', async () => {
      const dto = { status: 'DELIVERING' as const };
      prisma.deliverySchedule.update.mockResolvedValue({
        id: mockDeliveryId,
        status: 'DELIVERING',
      });

      const result = await service.update(mockDeliveryId, dto as any);

      expect(result.status).toBe('DELIVERING');
      expect(prisma.deliverySchedule.update).toHaveBeenCalledWith({
        where: { id: mockDeliveryId },
        data: dto,
      });
    });
  });

  describe('remove', () => {
    it('should soft-delete by setting isActive to false', async () => {
      prisma.deliverySchedule.update.mockResolvedValue({
        id: mockDeliveryId,
        isActive: false,
      });

      await service.remove(mockDeliveryId);

      expect(prisma.deliverySchedule.update).toHaveBeenCalledWith({
        where: { id: mockDeliveryId },
        data: { isActive: false },
      });
    });
  });

  describe('findAllQuantity', () => {
    it('should return grouped status counts with ACTIVE total', async () => {
      prisma.deliverySchedule.groupBy.mockResolvedValue([
        { status: 'IN_PRODUCTION', _count: 5 },
        { status: 'DELIVERING', _count: 3 },
        { status: 'FINISHED', _count: 8 },
        { status: 'DONE', _count: 2 },
      ]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.IN_PRODUCTION).toBe(5);
      expect(result.DELIVERING).toBe(3);
      expect(result.FINISHED).toBe(8);
      expect(result.DONE).toBe(2);
      expect(result.ACTIVE).toBe(8); // IN_PRODUCTION + DELIVERING
      expect(result.TOTAL).toBe(18);
    });

    it('should handle empty results', async () => {
      prisma.deliverySchedule.groupBy.mockResolvedValue([]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.IN_PRODUCTION).toBe(0);
      expect(result.DELIVERING).toBe(0);
      expect(result.ACTIVE).toBe(0);
      expect(result.TOTAL).toBe(0);
    });
  });

  describe('finishDeliverySchedule', () => {
    it('should finish with DONE status when receivables exist', async () => {
      prisma.deliverySchedule.findUnique.mockResolvedValue({
        id: mockDeliveryId,
        order: { id: mockOrderId },
        quotation: {
          id: mockQuotationId,
          receivable: [{ id: 'recv-1' }],
        },
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          deliverySchedule: { update: jest.fn().mockResolvedValue({}) },
          order: { update: jest.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      await service.finishDeliverySchedule(mockDeliveryId);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should finish with FINISHED status when no receivables', async () => {
      prisma.deliverySchedule.findUnique.mockResolvedValue({
        id: mockDeliveryId,
        order: { id: mockOrderId },
        quotation: {
          id: mockQuotationId,
          receivable: [],
        },
      });

      let capturedStatus: string | undefined;
      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          deliverySchedule: {
            update: jest.fn().mockImplementation(({ data }) => {
              capturedStatus = data.status;
              return Promise.resolve({});
            }),
          },
          order: { update: jest.fn().mockResolvedValue({}) },
        };
        return callback(tx);
      });

      await service.finishDeliverySchedule(mockDeliveryId);

      expect(capturedStatus).toBe('FINISHED');
    });

    it('should throw NotFoundException when delivery schedule not found', async () => {
      prisma.deliverySchedule.findUnique.mockResolvedValue(null);

      await expect(
        service.finishDeliverySchedule('invalid-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException on transaction failure', async () => {
      prisma.deliverySchedule.findUnique.mockResolvedValue({
        id: mockDeliveryId,
        order: { id: mockOrderId },
        quotation: {
          id: mockQuotationId,
          receivable: [],
        },
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const tx = {
          deliverySchedule: {
            update: jest.fn().mockRejectedValue(new Error('DB error')),
          },
          order: { update: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        service.finishDeliverySchedule(mockDeliveryId),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('getFinancialDataById', () => {
    it('should return null when no receivables found', async () => {
      prisma.receivable.findMany.mockResolvedValue([]);

      const result = await service.getFinancialDataById(mockQuotationId);

      expect(result).toBeNull();
      expect(prisma.receivable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quotationId: mockQuotationId },
        }),
      );
    });

    it('should aggregate amounts from multiple receivables', async () => {
      prisma.receivable.findMany.mockResolvedValue([
        {
          id: 'recv-1',
          totalAmount: 10000,
          description: 'Produto principal',
          notes: 'Nota A',
          status: 'ACTIVE',
          referenceDate: new Date('2026-03-01'),
          client: { id: 'c1', name: 'Cliente Teste' },
          nature: { id: 'n1', description: 'Vendas' },
          subCategory: { id: 'sc1', description: 'Produtos' },
          installments: [
            {
              id: 'inst-1',
              status: 'PAID',
              amount: 5000,
              paidAmount: 5000,
              additionalFee: 0,
              dueDate: new Date('2026-03-01'),
              paidDate: new Date('2026-03-01'),
              installmentNumber: 1,
            },
            {
              id: 'inst-2',
              status: 'PENDING',
              amount: 5000,
              paidAmount: 0,
              additionalFee: 100,
              dueDate: new Date('2026-04-01'),
              paidDate: null,
              installmentNumber: 2,
            },
          ],
        },
        {
          id: 'recv-2',
          totalAmount: 3000,
          description: 'Entrada',
          notes: null,
          status: 'PAID',
          referenceDate: new Date('2026-03-01'),
          client: { id: 'c1', name: 'Cliente Teste' },
          nature: { id: 'n1', description: 'Vendas' },
          subCategory: { id: 'sc1', description: 'Produtos' },
          installments: [
            {
              id: 'inst-3',
              status: 'PAID',
              amount: 3000,
              paidAmount: 3000,
              additionalFee: 0,
              dueDate: new Date('2026-02-15'),
              paidDate: new Date('2026-02-15'),
              installmentNumber: 1,
            },
          ],
        },
      ]);

      const result = await service.getFinancialDataById(mockQuotationId);

      expect(result).not.toBeNull();
      expect(result.totalValue).toBe(13000); // 10000 + 3000
      expect(result.totalPaid).toBe(8000); // 5000 + 3000
      expect(result.installmentsQuantity).toBe(3);
      expect(result.id).toBe('recv-1');
      // Description should prefer non-"Entrada" receivable
      expect(result.description).toBe('Produto principal');
      // Installments sorted by dueDate
      expect(result.installments[0].id).toBe('inst-3'); // earliest dueDate
      expect(result.installments[2].id).toBe('inst-2'); // latest dueDate
    });

    it('should handle receivables with null amounts', async () => {
      prisma.receivable.findMany.mockResolvedValue([
        {
          id: 'recv-1',
          totalAmount: null,
          description: 'Test',
          notes: null,
          status: 'ACTIVE',
          referenceDate: new Date(),
          client: { id: 'c1', name: 'Test' },
          nature: { id: 'n1', description: 'N' },
          subCategory: { id: 'sc1', description: 'SC' },
          installments: [
            {
              id: 'inst-1',
              status: 'PENDING',
              amount: null,
              paidAmount: null,
              additionalFee: null,
              dueDate: new Date(),
              paidDate: null,
              installmentNumber: 1,
            },
          ],
        },
      ]);

      const result = await service.getFinancialDataById(mockQuotationId);

      expect(result.totalValue).toBe(0);
      expect(result.totalPaid).toBe(0);
      expect(result.installments[0].value).toBe(0);
    });
  });
});

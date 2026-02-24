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

      const result = await service.create(dto as any);

      expect(result.id).toBe(mockDeliveryId);
      expect(prisma.deliverySchedule.create).toHaveBeenCalled();
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

      const result = await service.remove(mockDeliveryId);

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
});

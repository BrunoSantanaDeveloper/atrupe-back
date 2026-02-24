import { Test, TestingModule } from '@nestjs/testing';
import { SaleSeriesService } from './series.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockCompanyId = 'company-uuid-123';
const mockSeriesId = 'series-uuid-456';

const mockSeries = {
  id: mockSeriesId,
  companyId: mockCompanyId,
  code: 'SER-01',
  description: 'Série Padrão',
  billing: 'ON_ORDER',
  sendToProduction: 'DIRECT',
  productionStatus: 'MANAGE_PRODUCTION',
  isActive: true,
  isDefault: false,
  isTraining: false,
  proposalValidity: 7,
};

const createMockPrismaService = () => {
  const mock: any = {
    saleSeries: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  mock.$transaction = jest.fn((cb: (tx: any) => Promise<any>) => cb(mock));
  return mock;
};

describe('SaleSeriesService', () => {
  let service: SaleSeriesService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleSeriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SaleSeriesService>(SaleSeriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a sale series', async () => {
      const dto = {
        companyId: mockCompanyId,
        code: 'SER-01',
        description: 'Nova Série',
      } as any;
      prisma.saleSeries.create.mockResolvedValue({ id: mockSeriesId, ...dto });

      const result = await service.create(dto);

      expect(result.id).toBe(mockSeriesId);
      expect(prisma.saleSeries.create).toHaveBeenCalledWith({ data: dto });
    });

    it('should throw BadRequestException on duplicate code (P2002)', async () => {
      const dto = { code: 'SER-01' } as any;
      const error = new Error('Unique constraint');
      (error as any).code = 'P2002';
      prisma.saleSeries.create.mockRejectedValue(error);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(
        'Sale series code already exists',
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results with formatted series', async () => {
      prisma.saleSeries.count.mockResolvedValue(25);
      prisma.saleSeries.findMany.mockResolvedValue([
        mockSeries,
        { ...mockSeries, id: 'series-2', code: 'SER-02' },
      ]);

      const result = await service.findAll({
        companyId: mockCompanyId,
        page: '1',
        limit: '10',
      } as any);

      expect(result.total).toBe(25);
      expect(result.lastPage).toBe(3); // ceil(25/10)
      expect(result.data).toHaveLength(2);
      // Verify formatting applied
      expect(result.data[0].billing).toEqual({
        value: 'ON_ORDER',
        label: 'Faturar no pedido',
      });
    });

    it('should filter by isActive when provided', async () => {
      prisma.saleSeries.count.mockResolvedValue(0);
      prisma.saleSeries.findMany.mockResolvedValue([]);

      await service.findAll({
        companyId: mockCompanyId,
        page: '1',
        limit: '10',
        isActive: true,
      } as any);

      expect(prisma.saleSeries.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: mockCompanyId, isActive: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return formatted series by id', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue(mockSeries);

      const result = await service.findOne(mockSeriesId);

      expect(result.billing).toEqual({
        value: 'ON_ORDER',
        label: 'Faturar no pedido',
      });
      expect(result.sendToProduction).toEqual({
        value: 'DIRECT',
        label: 'Enviar Diretamente',
      });
      expect(result.productionStatus).toEqual({
        value: 'MANAGE_PRODUCTION',
        label: 'Gerenciar produção',
      });
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a sale series', async () => {
      const dto = { description: 'Updated' } as any;
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        description: 'Updated',
      });

      const result = await service.update(mockSeriesId, dto);

      expect(result.description).toBe('Updated');
    });

    it('should clear other defaults when setting isDefault=true', async () => {
      const dto = { isDefault: true } as any;
      prisma.saleSeries.findUnique.mockResolvedValue({
        companyId: mockCompanyId,
      });
      prisma.saleSeries.updateMany.mockResolvedValue({ count: 2 });
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        isDefault: true,
      });

      await service.update(mockSeriesId, dto);

      expect(prisma.saleSeries.updateMany).toHaveBeenCalledWith({
        where: { companyId: mockCompanyId, id: { not: mockSeriesId } },
        data: { isDefault: false },
      });
    });

    it('should not clear defaults when isDefault is not true', async () => {
      const dto = { description: 'Changed' } as any;
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        description: 'Changed',
      });

      await service.update(mockSeriesId, dto);

      expect(prisma.saleSeries.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft-delete by setting isActive to false', async () => {
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        isActive: false,
      });

      const result = await service.remove(mockSeriesId);

      expect(result.isActive).toBe(false);
      expect(prisma.saleSeries.update).toHaveBeenCalledWith({
        where: { id: mockSeriesId },
        data: { isActive: false },
      });
    });
  });

  describe('formatSeries', () => {
    it('should map billing to label', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue({
        ...mockSeries,
        billing: 'ON_DELIVERY',
      });

      const result = await service.findOne(mockSeriesId);

      expect(result.billing).toEqual({
        value: 'ON_DELIVERY',
        label: 'Faturar na entrega',
      });
    });

    it('should pass through unknown enum values as labels', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue({
        ...mockSeries,
        billing: 'UNKNOWN_VALUE',
      });

      const result = await service.findOne(mockSeriesId);

      expect(result.billing).toEqual({
        value: 'UNKNOWN_VALUE',
        label: 'UNKNOWN_VALUE',
      });
    });
  });
});

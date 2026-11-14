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
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    sellerProfile: { count: jest.fn() },
    transaction: { findMany: jest.fn(), deleteMany: jest.fn() },
    cashRegister: { update: jest.fn() },
  };
  // O expurgo apaga, em ordem, tudo o que pende da série
  for (const model of [
    'productionStage',
    'deliverySchedule',
    'order',
    'deliveryInfo',
    'quotationInstallment',
    'quotationPayment',
    'quotationProductItem',
    'quotationProduct',
    'payableInstallment',
    'receivableInstallment',
    'payable',
    'receivable',
    'quotation',
  ]) {
    mock[model] = { deleteMany: jest.fn() };
  }
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
      prisma.saleSeries.findFirst.mockResolvedValue(mockSeries);

      const result = await service.findOne(mockSeriesId, mockCompanyId);

      expect(prisma.saleSeries.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockSeriesId, companyId: mockCompanyId, isActive: true },
        }),
      );
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

    it('should throw NotFoundException when not found (ou de outra empresa)', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', mockCompanyId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        id: mockSeriesId,
        isTraining: false,
      });
    });

    it('should update a sale series', async () => {
      const dto = { description: 'Updated' } as any;
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        description: 'Updated',
      });

      const result = await service.update(mockSeriesId, mockCompanyId, dto);

      expect(result.description).toBe('Updated');
    });

    it('não altera a série de outra empresa', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue(null);

      await expect(
        service.update('series-de-outra', mockCompanyId, {
          description: 'x',
        } as any),
      ).rejects.toThrow(
        new NotFoundException('Série de venda não encontrada.'),
      );
      expect(prisma.saleSeries.findFirst).toHaveBeenCalledWith({
        where: { id: 'series-de-outra', companyId: mockCompanyId },
        select: { id: true, isTraining: true },
      });
      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
    });

    it('não restringe a série a perfil de vendedor de outra empresa', async () => {
      prisma.sellerProfile.count.mockResolvedValue(1);

      await expect(
        service.update(mockSeriesId, mockCompanyId, {
          allowedProfileIds: ['perfil-1', 'perfil-de-outra'],
        } as any),
      ).rejects.toThrow(
        new NotFoundException('Perfil de vendedor não encontrado.'),
      );
      expect(prisma.sellerProfile.count).toHaveBeenCalledWith({
        where: {
          id: { in: ['perfil-1', 'perfil-de-outra'] },
          companyId: mockCompanyId,
        },
      });
      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
    });

    it('should clear other defaults when setting isDefault=true', async () => {
      const dto = { isDefault: true } as any;
      prisma.saleSeries.updateMany.mockResolvedValue({ count: 2 });
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        isDefault: true,
      });

      await service.update(mockSeriesId, mockCompanyId, dto);

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

      await service.update(mockSeriesId, mockCompanyId, dto);

      expect(prisma.saleSeries.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft-delete by setting isActive to false', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        id: mockSeriesId,
        isTraining: false,
      });
      prisma.saleSeries.update.mockResolvedValue({
        ...mockSeries,
        isActive: false,
      });

      const result = await service.remove(mockSeriesId, mockCompanyId);

      expect(result.isActive).toBe(false);
      expect(prisma.saleSeries.update).toHaveBeenCalledWith({
        where: { id: mockSeriesId },
        data: { isActive: false },
      });
    });

    it('não inativa a série de outra empresa', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('series-de-outra', mockCompanyId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
    });
  });

  describe('removeTrainingSerieData (apagar os dados de treinamento)', () => {
    it('não toca a série de outra empresa', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue(null);

      await expect(
        service.removeTrainingSerieData('series-de-outra', mockCompanyId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa série que não é de treinamento', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        id: mockSeriesId,
        isTraining: false,
      });

      await expect(
        service.removeTrainingSerieData(mockSeriesId, mockCompanyId),
      ).rejects.toMatchObject({ response: { code: 'NOT_TRAINING_SERIES' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('só pega as transações que pagam apenas parcelas da série, e apaga exatamente essas', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        id: mockSeriesId,
        isTraining: true,
      });
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 't-1',
          type: 'INCOME',
          amount: 100,
          cashRegister: { id: 'cx-1', status: 'OPEN' },
        },
        {
          id: 't-2',
          type: 'OUTCOME',
          amount: 30,
          cashRegister: { id: 'cx-1', status: 'CLOSED' },
        },
      ]);

      await service.removeTrainingSerieData(mockSeriesId, mockCompanyId);

      const where = prisma.transaction.findMany.mock.calls[0][0].where;
      const ofSeries = {
        receivable: { quotation: { series: { id: mockSeriesId } } },
      };
      // `every` sozinho casava toda transação sem parcela desse lado
      expect(where.OR[0].receivableInstallment).toEqual({
        some: ofSeries,
        every: ofSeries,
      });
      expect(where.OR[1].payableInstallment.some).toEqual({
        payable: { quotation: { series: { id: mockSeriesId } } },
      });

      expect(prisma.cashRegister.update).toHaveBeenCalledWith({
        where: { id: 'cx-1' },
        data: { totalIncomes: { decrement: 100 } },
      });
      expect(prisma.cashRegister.update).toHaveBeenCalledWith({
        where: { id: 'cx-1' },
        data: {
          totalOutcomes: { decrement: 30 },
          closingBalance: { increment: 30 },
        },
      });
      expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['t-1', 't-2'] } },
      });
      expect(prisma.quotation.deleteMany).toHaveBeenCalledWith({
        where: { series: { id: mockSeriesId } },
      });
    });
  });

  describe('formatSeries', () => {
    it('should map billing to label', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        ...mockSeries,
        billing: 'ON_DELIVERY',
      });

      const result = await service.findOne(mockSeriesId, mockCompanyId);

      expect(result.billing).toEqual({
        value: 'ON_DELIVERY',
        label: 'Faturar na entrega',
      });
    });

    it.each([
      ['ON_CHECKOUT', 'Faturar na frente de caixa'],
      ['ON_SALE', 'Cobrar na venda'],
    ])('a série %s tem nome na lista', async (billing, label) => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        ...mockSeries,
        billing,
      });

      const result = await service.findOne(mockSeriesId, mockCompanyId);

      expect(result.billing).toEqual({ value: billing, label });
    });

    it('should pass through unknown enum values as labels', async () => {
      prisma.saleSeries.findFirst.mockResolvedValue({
        ...mockSeries,
        billing: 'UNKNOWN_VALUE',
      });

      const result = await service.findOne(mockSeriesId, mockCompanyId);

      expect(result.billing).toEqual({
        value: 'UNKNOWN_VALUE',
        label: 'UNKNOWN_VALUE',
      });
    });
  });
});

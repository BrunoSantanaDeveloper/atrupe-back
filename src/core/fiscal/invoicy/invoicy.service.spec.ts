import { Test, TestingModule } from '@nestjs/testing';
import { InvoicyService } from './invoicy.service';
import { PrismaService } from 'nestjs-prisma';
import { ConfigService } from '@nestjs/config';
import { InvoicyHttpService } from './invoicy-http.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('InvoicyService', () => {
  let service: InvoicyService;

  const mockPrisma = {
    invoicyConfig: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockInvoicyHttpService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
      ],
    }).compile();

    service = module.get<InvoicyService>(InvoicyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create config', () => {
    it('should throw ConflictException if name exists', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue({ id: 'config-1' });
      await expect(
        service.create('company-1', { name: 'Matriz' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create default configs with default values', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(null);
      mockPrisma.invoicyConfig.count.mockResolvedValue(0);
      mockPrisma.invoicyConfig.create.mockResolvedValue({
        id: 'config-1',
        isDefault: true,
        environment: 'HOMOLOGACAO',
        ambiente: 2,
        serieNfe: 1,
        proximoNumeroNfe: 1,
      });

      const result = await service.create('company-1', {
        name: 'Matriz',
        ambiente: 2,
        environment: 'HOMOLOGACAO',
      } as any);

      expect(mockPrisma.invoicyConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isDefault: true,
            ambiente: 2,
            environment: 'HOMOLOGACAO',
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should remove default from others if creating a new default', async () => {
      mockPrisma.invoicyConfig.findFirst.mockResolvedValue(null);
      mockPrisma.invoicyConfig.count.mockResolvedValue(1); // not first
      mockPrisma.invoicyConfig.updateMany.mockResolvedValue({});
      mockPrisma.invoicyConfig.create.mockResolvedValue({
        id: 'config-2',
        isDefault: true,
      });

      await service.create('company-1', {
        name: 'Filial',
        isDefault: true,
      } as any);

      expect(mockPrisma.invoicyConfig.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', isDefault: true },
        data: { isDefault: false },
      });
    });
  });

  describe('increment numbers', () => {
    it('should increment nfe number and return the previous value', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue({
        proximoNumeroNfe: 11,
      }); // Value after increment

      const result = await service.incrementNfeNumber('config-1');

      expect(mockPrisma.invoicyConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { proximoNumeroNfe: { increment: 1 } },
        select: { proximoNumeroNfe: true },
      });
      expect(result).toBe(10); // 11 - 1
    });

    it('should throw NotFoundException if incrementing nfe number of non-existent config', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue(null);
      await expect(service.incrementNfeNumber('config-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should increment nfce number and return the previous value', async () => {
      mockPrisma.invoicyConfig.update.mockResolvedValue({
        proximoNumeroNfce: 5,
      });

      const result = await service.incrementNfceNumber('config-1');

      expect(mockPrisma.invoicyConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: { proximoNumeroNfce: { increment: 1 } },
        select: { proximoNumeroNfce: true },
      });
      expect(result).toBe(4); // 5 - 1
    });
  });
});

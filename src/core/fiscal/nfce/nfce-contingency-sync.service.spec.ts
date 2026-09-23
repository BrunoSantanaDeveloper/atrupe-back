import { Test, TestingModule } from '@nestjs/testing';
import { NfceContingencySyncService } from './nfce-contingency-sync.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { NfceStatus } from '@prisma/client';

describe('NfceContingencySyncService', () => {
  let service: NfceContingencySyncService;

  const mockPrisma = {
    nfce: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    // Sem transferência que trocou o CNPJ: nada é histórico.
    company: { findUnique: jest.fn() },
    invoicyConfig: { findMany: jest.fn() },
  };

  const mockInvoicyService = {
    getConfig: jest.fn(),
  };

  const mockInvoicyApiService = {
    syncContingency: jest.fn(),
    checkSefazStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfceContingencySyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyApiService, useValue: mockInvoicyApiService },
      ],
    }).compile();

    service = module.get<NfceContingencySyncService>(
      NfceContingencySyncService,
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('syncContingencyNfces', () => {
    it('should skip if no contingency NFC-e found', async () => {
      mockPrisma.nfce.findMany.mockResolvedValue([]);

      await service.syncContingencyNfces();

      expect(mockPrisma.nfce.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: NfceStatus.CONTINGENCY },
        }),
      );
      expect(mockInvoicyApiService.syncContingency).not.toHaveBeenCalled();
    });

    it('should process contingency NFC-e when found', async () => {
      const mockNfces = [
        {
          id: 'nfce-1',
          companyId: 'company-1',
          numero: 1,
          status: NfceStatus.CONTINGENCY,
          createdAt: new Date(),
          company: { address: {} },
        },
      ];

      mockPrisma.nfce.findMany.mockResolvedValue(mockNfces);
      mockInvoicyService.getConfig.mockResolvedValue({ isActive: true });
      mockInvoicyApiService.checkSefazStatus.mockResolvedValue({
        available: true,
      });
      mockInvoicyApiService.syncContingency.mockResolvedValue([
        {
          Codigo: 200,
          Documentos: [
            {
              Situacao: { SitCodigo: 100 },
              DocChaAcesso: 'chave123',
              DocProtocolo: 'proto123',
            },
          ],
        },
      ]);

      await service.syncContingencyNfces();

      expect(mockInvoicyService.getConfig).toHaveBeenCalledWith('company-1');
      expect(mockInvoicyApiService.checkSefazStatus).toHaveBeenCalled();
    });

    it('should skip if config is not active', async () => {
      const mockNfces = [
        {
          id: 'nfce-1',
          companyId: 'company-1',
          numero: 1,
          status: NfceStatus.CONTINGENCY,
          createdAt: new Date(),
        },
      ];

      mockPrisma.nfce.findMany.mockResolvedValue(mockNfces);
      mockInvoicyService.getConfig.mockResolvedValue({ isActive: false });

      await service.syncContingencyNfces();

      expect(mockInvoicyApiService.syncContingency).not.toHaveBeenCalled();
    });

    it('should skip if SEFAZ is unavailable', async () => {
      const mockNfces = [
        {
          id: 'nfce-1',
          companyId: 'company-1',
          numero: 1,
          status: NfceStatus.CONTINGENCY,
          createdAt: new Date(),
        },
      ];

      mockPrisma.nfce.findMany.mockResolvedValue(mockNfces);
      mockInvoicyService.getConfig.mockResolvedValue({ isActive: true });
      mockInvoicyApiService.checkSefazStatus.mockResolvedValue({
        available: false,
      });

      await service.syncContingencyNfces();

      expect(mockInvoicyApiService.syncContingency).not.toHaveBeenCalled();
    });
  });

  describe('forceSyncNfce', () => {
    it('should return error if NFC-e not found', async () => {
      mockPrisma.nfce.findFirst.mockResolvedValue(null);

      const result = await service.forceSyncNfce('company-1', 'nfce-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('não encontrada');
    });

    it('should return error if config not found', async () => {
      mockPrisma.nfce.findFirst.mockResolvedValue({
        id: 'nfce-1',
        status: NfceStatus.CONTINGENCY,
      });
      mockInvoicyService.getConfig.mockResolvedValue(null);

      const result = await service.forceSyncNfce('company-1', 'nfce-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Configuração');
    });

    it('should sync and return success when authorized', async () => {
      const mockNfce = {
        id: 'nfce-1',
        numero: 1,
        status: NfceStatus.CONTINGENCY,
        createdAt: new Date(),
      };

      mockPrisma.nfce.findFirst.mockResolvedValue(mockNfce);
      mockInvoicyService.getConfig.mockResolvedValue({ isActive: true });
      mockInvoicyApiService.checkSefazStatus.mockResolvedValue({
        available: true,
      });
      mockInvoicyApiService.syncContingency.mockResolvedValue([
        {
          Codigo: 200,
          Documentos: [{ Situacao: { SitCodigo: 100 } }],
        },
      ]);
      mockPrisma.nfce.update.mockResolvedValue({
        ...mockNfce,
        status: NfceStatus.AUTHORIZED,
      });
      mockPrisma.nfce.findUnique.mockResolvedValue({
        ...mockNfce,
        status: NfceStatus.AUTHORIZED,
      });

      const result = await service.forceSyncNfce('company-1', 'nfce-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('autorizada');
    });
  });

  describe('getContingencyStats', () => {
    it('should return stats for all companies', async () => {
      mockPrisma.nfce.count.mockResolvedValue(5);
      mockPrisma.nfce.groupBy.mockResolvedValue([
        { companyId: 'company-1', _count: 3 },
        { companyId: 'company-2', _count: 2 },
      ]);
      mockPrisma.nfce.findFirst.mockResolvedValue({
        createdAt: new Date('2026-01-01'),
      });

      const stats = await service.getContingencyStats();

      expect(stats.total).toBe(5);
      expect(stats.byCompany).toEqual({
        'company-1': 3,
        'company-2': 2,
      });
      expect(stats.oldest).toBeInstanceOf(Date);
    });

    it('should filter by company when provided', async () => {
      mockPrisma.nfce.count.mockResolvedValue(3);
      mockPrisma.nfce.groupBy.mockResolvedValue([
        { companyId: 'company-1', _count: 3 },
      ]);
      mockPrisma.nfce.findFirst.mockResolvedValue(null);

      await service.getContingencyStats('company-1');

      expect(mockPrisma.nfce.count).toHaveBeenCalledWith({
        where: { companyId: 'company-1', status: NfceStatus.CONTINGENCY },
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { NfceService } from './nfce.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NfceStatus } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockNfceId = 'nfce-uuid-789';

const mockNfce = {
  id: mockNfceId,
  companyId: mockCompanyId,
  numero: 1,
  serie: 1,
  status: NfceStatus.PENDING,
  ambiente: 2,
  valorTotal: 150,
  contingencia: false,
};

const mockInvoicyResponse = {
  success: true,
  data: {
    chaveAcesso: '35260212345678000165650010000000011234567890',
    protocolo: '123456789012345',
    status: 'AUTORIZADO',
    qrCodeUrl: 'https://qrcode.url/123',
    danfeUrl: 'https://danfe.url/123',
  },
};

const mockPrismaService = {
  company: { findUnique: jest.fn() },
  nfce: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  invoicyConfig: { findFirst: jest.fn(), update: jest.fn() },
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  incrementNfceNumber: jest.fn(),
};

const mockInvoicyHttpService = {
  emitNfce: jest.fn(),
  cancelNfce: jest.fn(),
  inutilizarNfce: jest.fn(),
};

describe('NfceService', () => {
  let service: NfceService;
  let prisma: typeof mockPrismaService;
  let invoicyService: typeof mockInvoicyService;
  let invoicyHttpService: typeof mockInvoicyHttpService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
      ],
    }).compile();

    service = module.get<NfceService>(NfceService);
    prisma = module.get(PrismaService);
    invoicyService = module.get(InvoicyService);
    invoicyHttpService = module.get(InvoicyHttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated list', async () => {
      prisma.nfce.findMany.mockResolvedValue([mockNfce]);
      prisma.nfce.count.mockResolvedValue(1);

      const result = await service.findAll(mockCompanyId, {});

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('should return NFC-e when found', async () => {
      prisma.nfce.findFirst.mockResolvedValue(mockNfce);

      const result = await service.findById(mockNfceId, mockCompanyId);

      expect(result.id).toBe(mockNfceId);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.nfce.findFirst.mockResolvedValue(null);

      await expect(service.findById('invalid', mockCompanyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByChaveAcesso', () => {
    it('should find by chaveAcesso', async () => {
      prisma.nfce.findUnique.mockResolvedValue({
        ...mockNfce,
        chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
      });

      const result = await service.findByChaveAcesso(
        mockInvoicyResponse.data.chaveAcesso,
      );

      expect(result).toBeDefined();
    });
  });

  describe('emit', () => {
    beforeEach(() => {
      prisma.company.findUnique.mockResolvedValue({
        id: mockCompanyId,
        name: 'Empresa',
        document: '12345678000123',
      });
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfce: 1,
        proximoNumeroNfce: 1,
        ambiente: 2,
      });
      invoicyHttpService.emitNfce.mockResolvedValue(mockInvoicyResponse);
      prisma.nfce.create.mockResolvedValue(mockNfce);
      prisma.nfce.update.mockResolvedValue({
        ...mockNfce,
        status: NfceStatus.AUTHORIZED,
        chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
      });
    });

    it('should emit NFC-e successfully', async () => {
      const result = await service.emit(mockCompanyId, {
        items: [{ productId: '1', quantity: 1, unitValue: 100 }],
        payment: { forma: '01', valor: 100 },
      });

      expect(result.status).toBe(NfceStatus.AUTHORIZED);
      expect(result.chaveAcesso).toBeDefined();
    });

    it('should increment NFC-e number after emission', async () => {
      await service.emit(mockCompanyId, {
        items: [{ productId: '1', quantity: 1, unitValue: 100 }],
      });

      expect(invoicyService.incrementNfceNumber).toHaveBeenCalledWith(
        mockCompanyId,
      );
    });
  });

  describe('cancel', () => {
    const authorizedNfce = {
      ...mockNfce,
      status: NfceStatus.AUTHORIZED,
      chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
    };

    beforeEach(() => {
      prisma.nfce.findFirst.mockResolvedValue(authorizedNfce);
      invoicyHttpService.cancelNfce.mockResolvedValue({ success: true });
      prisma.nfce.update.mockResolvedValue({
        ...authorizedNfce,
        status: NfceStatus.CANCELLED,
      });
    });

    it('should cancel authorized NFC-e', async () => {
      const result = await service.cancel(mockNfceId, mockCompanyId, {
        justificativa: 'Cancelamento por erro na venda',
      });

      expect(result.status).toBe(NfceStatus.CANCELLED);
    });

    it('should throw if NFC-e not authorized', async () => {
      prisma.nfce.findFirst.mockResolvedValue(mockNfce); // PENDING

      await expect(
        service.cancel(mockNfceId, mockCompanyId, {
          justificativa: 'Teste cancelamento',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('inutilizar', () => {
    beforeEach(() => {
      invoicyHttpService.inutilizarNfce.mockResolvedValue({ success: true });
    });

    it('should inutilizar number range', async () => {
      await service.inutilizar(mockCompanyId, {
        serie: 1,
        numeroInicial: 1,
        numeroFinal: 5,
        justificativa: 'Numeração perdida por falha técnica',
      });

      expect(invoicyHttpService.inutilizarNfce).toHaveBeenCalledWith(
        expect.objectContaining({
          serie: 1,
          numeroInicial: 1,
          numeroFinal: 5,
        }),
      );
    });
  });

  describe('toggleContingencia', () => {
    beforeEach(() => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        id: 'config-1',
        contingencia: false,
      });
      prisma.invoicyConfig.update.mockResolvedValue({
        id: 'config-1',
        contingencia: true,
      });
    });

    it('should toggle contingency mode', async () => {
      const result = await service.toggleContingencia(mockCompanyId, {
        ativar: true,
        justificativa: 'SEFAZ offline',
      });

      expect(result.contingencia).toBe(true);
    });
  });

  describe('getQrCode', () => {
    it('should return QR code URL', async () => {
      prisma.nfce.findFirst.mockResolvedValue({
        ...mockNfce,
        qrCodeUrl: 'https://qrcode.url/123',
      });

      const result = await service.getQrCode(mockNfceId, mockCompanyId);

      expect(result).toBe('https://qrcode.url/123');
    });

    it('should throw if NFC-e not found', async () => {
      prisma.nfce.findFirst.mockResolvedValue(null);

      await expect(service.getQrCode('invalid', mockCompanyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

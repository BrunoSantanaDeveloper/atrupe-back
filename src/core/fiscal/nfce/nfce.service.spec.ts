import { Test, TestingModule } from '@nestjs/testing';
import { NfceService } from './nfce.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
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
  productFiscalData: { findMany: jest.fn() },
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  getConfig: jest.fn(),
  incrementNfceNumber: jest.fn(),
};

const mockInvoicyApiService = {
  emitNfce: jest.fn(),
  emitNfe: jest.fn(), // emit NFC-e usa internamente emitNfe
  cancelNfce: jest.fn(),
  cancelNfe: jest.fn(),
  inutilizarNfce: jest.fn(),
};

describe('NfceService', () => {
  let service: NfceService;
  let prisma: typeof mockPrismaService;
  let invoicyService: typeof mockInvoicyService;
  let invoicyApiService: typeof mockInvoicyApiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyApiService, useValue: mockInvoicyApiService },
      ],
    }).compile();

    service = module.get<NfceService>(NfceService);
    prisma = module.get(PrismaService);
    invoicyService = module.get(InvoicyService);
    invoicyApiService = module.get(InvoicyApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated list', async () => {
      prisma.nfce.findMany.mockResolvedValue([mockNfce]);
      prisma.nfce.count.mockResolvedValue(1);

      const result = await service.findAll(mockCompanyId, {});

      expect(result.items).toHaveLength(1);
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
      prisma.nfce.findFirst.mockResolvedValue({
        ...mockNfce,
        chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
      });

      const result = await service.findByChaveAcesso(
        mockInvoicyResponse.data.chaveAcesso,
        mockCompanyId,
      );

      expect(result).toBeDefined();
    });
  });

  describe('emit', () => {
    beforeEach(() => {
      prisma.productFiscalData.findMany.mockResolvedValue([]);
      prisma.company.findUnique.mockResolvedValue({
        id: mockCompanyId,
        name: 'Empresa',
        document: '12345678000123',
      });
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        serieNfce: 1,
        proximoNumeroNfce: 1,
        ambiente: 2,
        isActive: true,
        ibgeCode: '4314902',
        emitCrt: 1,
        company: {
          cnpj: '12345678000123',
          legalName: 'Empresa Teste LTDA',
          stateRegistration: '1234567890',
          address: {
            street: 'Rua Teste',
            number: '100',
            neighborhood: 'Centro',
            city: 'Porto Alegre',
            state: 'RS',
            zipcode: '90000000',
          },
        },
      });
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfce: 1,
        proximoNumeroNfce: 1,
        ambiente: 2,
      });
      invoicyApiService.emitNfe.mockResolvedValue([
        {
          Codigo: 100,
          Descricao: 'Documentos processados com sucesso',
          Documentos: [
            {
              DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
              DocProtocolo: mockInvoicyResponse.data.protocolo,
              DocIDUnico: 'invoicy-id-123',
              DocPDFDownload: mockInvoicyResponse.data.danfeUrl,
              DocCompleto: mockInvoicyResponse.data.qrCodeUrl,
              Situacao: {
                SitCodigo: 100,
                SitDescricao: 'Autorizado o uso da NF-e',
              },
            },
          ],
        },
      ]);
      prisma.nfce.create.mockResolvedValue(mockNfce);
      prisma.nfce.update.mockResolvedValue({
        ...mockNfce,
        status: NfceStatus.AUTHORIZED,
        chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
      });
    });

    it('should emit NFC-e successfully', async () => {
      const result = await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda ao consumidor final',
        itens: [
          {
            productId: '1',
            codigo: '001',
            descricao: 'Produto',
            ncm: '12345678',
            cfop: '5102',
            unidade: 'UN',
            quantidade: 1,
            valorUnitario: 100,
          },
        ],
        pagamentos: [{ tipo: '01', valor: 100 }],
      });

      expect(result.status).toBe(NfceStatus.AUTHORIZED);
      expect(result.chaveAcesso).toBeDefined();
    });

    it('should increment NFC-e number after emission', async () => {
      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        itens: [
          {
            productId: '1',
            codigo: '001',
            descricao: 'Produto',
            ncm: '12345678',
            cfop: '5102',
            unidade: 'UN',
            quantidade: 1,
            valorUnitario: 100,
          },
        ],
        pagamentos: [{ tipo: '01', valor: 100 }],
      });

      expect(invoicyService.incrementNfceNumber).toHaveBeenCalledWith(
        'config-1', // incrementNfceNumber recebe config.id
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
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        serieNfce: 1,
        ambiente: 2,
      });
      invoicyApiService.cancelNfe.mockResolvedValue([
        {
          Codigo: 100,
          Descricao: 'Documentos processados com sucesso',
          Documentos: [
            {
              DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
              DocProtocolo: '123456789012345',
              Situacao: {
                SitCodigo: 135,
                SitDescricao: 'Evento registrado e vinculado a NFC-e',
              },
            },
          ],
        },
      ]);
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
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        serieNfce: 1,
        ambiente: 2,
      });
      invoicyApiService.inutilizarNfce.mockResolvedValue([
        {
          Codigo: 100,
          Descricao: 'Documentos processados com sucesso',
          Documentos: [
            {
              DocProtocolo: '987654321098765',
              Situacao: {
                SitCodigo: 102,
                SitDescricao: 'Inutilização de número homologada',
              },
            },
          ],
        },
      ]);
    });

    it('should inutilizar number range', async () => {
      await service.inutilizar(mockCompanyId, {
        numeroInicial: 1,
        numeroFinal: 5,
        justificativa: 'Numeração perdida por falha técnica',
      });

      expect(invoicyApiService.inutilizarNfce).toHaveBeenCalledWith(
        mockCompanyId,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
      );
    });
  });

  describe('toggleContingencia', () => {
    beforeEach(() => {
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        contingenciaNfceAtiva: false,
      });
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        id: 'config-1',
        contingenciaNfceAtiva: false,
      });
      prisma.invoicyConfig.update.mockResolvedValue({
        id: 'config-1',
        contingenciaNfceAtiva: true,
        contingenciaNfceMotivo: 'SEFAZ offline',
        contingenciaNfceDataHora: new Date(),
      });
    });

    it('should toggle contingency mode', async () => {
      const result = await service.toggleContingencia(mockCompanyId, {
        ativar: true,
        motivo: 'SEFAZ offline',
      });

      expect(result.contingenciaAtiva).toBe(true);
    });
  });

  describe('getQrCode', () => {
    it('should return QR code URL', async () => {
      prisma.nfce.findFirst.mockResolvedValue({
        ...mockNfce,
        qrCodeUrl: 'https://qrcode.url/123',
      });

      const result = await service.getQrCode(mockNfceId, mockCompanyId);

      expect(result.url).toBe('https://qrcode.url/123');
    });

    it('should throw if NFC-e not found', async () => {
      prisma.nfce.findFirst.mockResolvedValue(null);

      await expect(service.getQrCode('invalid', mockCompanyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

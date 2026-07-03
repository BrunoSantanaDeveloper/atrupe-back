import { Test, TestingModule } from '@nestjs/testing';
import { NfceService } from './nfce.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
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
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  invoicyConfig: { findFirst: jest.fn(), update: jest.fn() },
  productFiscalData: { findMany: jest.fn() },
  $transaction: jest.fn((callback) => callback(mockPrismaService)),
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  getConfig: jest.fn(),
};

const mockInvoicyApiService = {
  emitNfce: jest.fn(),
  emitNfe: jest.fn(), // emit NFC-e usa internamente emitNfe
  cancelNfce: jest.fn(),
  cancelNfe: jest.fn(),
  inutilizarNfce: jest.fn(),
  consultNfeSefaz: jest.fn(),
};

const mockFiscalCredentialResolver = {
  resolveOperationalEnvironment: jest.fn().mockResolvedValue('HOMOLOGACAO'),
  assertEnvironmentReady: jest.fn().mockResolvedValue(undefined),
  getEmissorRuntimeCredentials: jest.fn().mockResolvedValue({
    cscId: '1',
    cscToken: 'CSC_TOKEN_TESTE',
    nfceNextNumber: 1,
    nfceSeries: 1,
  }),
  reserveNfceNumber: jest
    .fn()
    .mockResolvedValue({ reservedNumber: 1, series: 1 }),
};

describe('NfceService', () => {
  let service: NfceService;
  let prisma: typeof mockPrismaService;
  let invoicyService: typeof mockInvoicyService;
  let invoicyApiService: typeof mockInvoicyApiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restaurar mocks padrão do resolver após clearAllMocks
    mockFiscalCredentialResolver.resolveOperationalEnvironment.mockResolvedValue(
      'HOMOLOGACAO',
    );
    mockFiscalCredentialResolver.getEmissorRuntimeCredentials.mockResolvedValue(
      {
        cscId: '1',
        cscToken: 'CSC_TOKEN_TESTE',
        nfceNextNumber: 1,
        nfceSeries: 1,
      },
    );
    mockFiscalCredentialResolver.reserveNfceNumber.mockResolvedValue({
      reservedNumber: 1,
      series: 1,
    });
    mockPrismaService.$transaction.mockImplementation((callback) =>
      callback(mockPrismaService),
    );
    mockPrismaService.nfce.updateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyApiService, useValue: mockInvoicyApiService },
        {
          provide: FiscalCredentialResolverService,
          useValue: mockFiscalCredentialResolver,
        },
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
        cscId: '1',
        cscToken: 'CSC_TOKEN_TESTE',
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

    it('should reserve NFC-e number atomically before API call', async () => {
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

      // reserveNfceNumber deve ter sido chamado dentro de $transaction
      expect(
        mockFiscalCredentialResolver.reserveNfceNumber,
      ).toHaveBeenCalledWith(mockPrismaService, 'config-1', 'HOMOLOGACAO');
      // $transaction deve ter sido chamado para manter atomicidade
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should send recipient document when consumer CPF is provided', async () => {
      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        cpfConsumidor: '111.222.333-44',
        consumidorNome: 'Cliente Teste',
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

      const request = invoicyApiService.emitNfe.mock.calls[0][1][0];

      expect(request.Documento.dest).toMatchObject({
        CPF_dest: '11122233344',
        xNome_dest:
          'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
        indIEDest: 9,
      });
      expect(request.Documento.dest.enderDest).toBeUndefined();
    });

    it('should omit recipient when consumer CPF/CNPJ is not provided', async () => {
      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        consumidorNome: 'Cliente sem documento',
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

      const request = invoicyApiService.emitNfe.mock.calls[0][1][0];

      expect(request.Documento.dest).toBeUndefined();
    });

    it('should require CSC configuration before emission', async () => {
      // A validação de CSC agora vem de getEmissorRuntimeCredentials, não de getConfig
      mockFiscalCredentialResolver.getEmissorRuntimeCredentials.mockResolvedValueOnce(
        {
          cscId: null,
          cscToken: null,
          nfceNextNumber: 1,
          nfceSeries: 1,
        },
      );

      await expect(
        service.emit(mockCompanyId, {
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
        }),
      ).rejects.toThrow(BadRequestException);
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

  describe('emit — regressões fiscais', () => {
    const baseConfig = {
      id: 'config-1',
      contingenciaNfceAtiva: false,
      isActive: true,
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
      ibgeCode: '4314902',
      emitCrt: 1,
    };

    const successResponse = [
      {
        Codigo: 100,
        Descricao: 'Documentos processados com sucesso',
        Documentos: [
          {
            DocChaAcesso: '35260212345678000165650010000000011234567890',
            DocProtocolo: '123456789012345',
            DocIDUnico: 'invoicy-id-123',
            DocPDFDownload: 'https://danfe.url/123',
            DocCompleto: 'https://qrcode.url/123',
            DocXMLBase64: Buffer.from('<xml/>').toString('base64'),
            Situacao: {
              SitCodigo: 100,
              SitDescricao: 'Autorizado o uso da NF-e',
            },
          },
        ],
      },
    ];

    beforeEach(() => {
      invoicyService.getConfig.mockResolvedValue(baseConfig);
      prisma.productFiscalData.findMany.mockResolvedValue([]);
      prisma.nfce.create.mockResolvedValue(mockNfce);
      prisma.nfce.update.mockResolvedValue({
        ...mockNfce,
        status: NfceStatus.AUTHORIZED,
      });
    });

    it('destinatário sem CPF/CNPJ: dest ausente no payload', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        consumidorNome: 'Cliente sem documento',
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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.dest).toBeUndefined();
    });

    it('CPF 11 dígitos: dest.CPF_dest no payload', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        cpfConsumidor: '111.222.333-44',
        consumidorNome: 'Cliente Teste',
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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.dest).toMatchObject({
        CPF_dest: '11122233344',
        xNome_dest:
          'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL',
        indIEDest: 9,
      });
    });

    it('CNPJ 14 dígitos: dest.CNPJ_dest no payload', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

      await service.emit(mockCompanyId, {
        naturezaOperacao: 'Venda',
        cpfConsumidor: '12.345.678/0001-90',
        consumidorNome: 'Empresa Cliente',
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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.dest).toMatchObject({
        CNPJ_dest: '12345678000190',
      });
    });

    it('IE ISENTO: emit.IE = "ISENTO" no payload', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);
      invoicyService.getConfig.mockResolvedValueOnce({
        ...baseConfig,
        company: {
          ...baseConfig.company,
          stateRegistration: 'ISENTO',
        },
      });

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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.emit.IE).toBe('ISENTO');
    });

    it('IE numérica: emit.IE com dígitos no payload', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.emit.IE).toBe('1234567890');
    });

    it('cMun = 0: BadRequestException antes de chamar Invoicy', async () => {
      invoicyService.getConfig.mockResolvedValueOnce({
        ...baseConfig,
        ibgeCode: '', // sem código IBGE
      });

      await expect(
        service.emit(mockCompanyId, {
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
        }),
      ).rejects.toThrow(BadRequestException);

      // Confirmar que emitNfe NÃO foi chamado
      expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
    });

    it('erro de transporte (ECONNABORTED): lança BadRequestException com mensagem apropriada', async () => {
      invoicyApiService.emitNfe.mockRejectedValueOnce({
        code: 'ECONNABORTED',
      });

      const error = await service
        .emit(mockCompanyId, {
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
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('Falha de comunicação');
    });

    it('rejeição fiscal (SitCodigo ≠ 100/150): lança BadRequestException', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce([
        {
          Codigo: 100,
          Documentos: [
            {
              DocChaAcesso: '35260212345678000165650010000000011234567890',
              DocProtocolo: '123456789012345',
              Situacao: {
                SitCodigo: 302, // Rejeição
                SitDescricao: 'Falha na validação do XML',
              },
            },
          ],
        },
      ]);

      const error = await service
        .emit(mockCompanyId, {
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
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('rejeitada');
    });

    it('ambiente PRODUCAO: tpAmb = 1', async () => {
      mockFiscalCredentialResolver.resolveOperationalEnvironment.mockResolvedValueOnce(
        'PRODUCAO',
      );
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.ide.tpAmb).toBe(1);
      expect(mockNfce.ambiente).toBe(2); // porque setup padrão é HOMOLOGACAO
    });

    it('ambiente HOMOLOGACAO: tpAmb = 2', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

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

      const payload = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(payload.Documento.ide.tpAmb).toBe(2);
    });

    it('invoicyPayloadEnvio persistido para reprocessamento', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

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

      // Verificar que create foi chamado com invoicyPayloadEnvio
      expect(prisma.nfce.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoicyPayloadEnvio: expect.any(Object),
            invoicyConfigId: 'config-1',
          }),
        }),
      );
    });

    it('invoicyConfigId persisted para rastreabilidade', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce(successResponse);

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

      expect(prisma.nfce.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoicyConfigId: 'config-1',
          }),
        }),
      );

      expect(invoicyApiService.emitNfe).toHaveBeenCalledWith(
        mockCompanyId,
        expect.any(Array),
        'config-1',
      );
    });
  });

  describe('reprocess', () => {
    const unknownNfce = {
      ...mockNfce,
      status: NfceStatus.UNKNOWN,
      invoicyConfigId: 'config-1',
      invoicyPayloadEnvio: {
        Documento: {
          ModeloDocumento: 'NFCe',
          ide: { nNF: 1, serie: '1', tpEmis: 1 },
        },
      },
      chaveAcesso: null,
      protocolo: null,
      invoicyId: null,
      invoicyProtocol: null,
      dataAutorizacao: null,
      qrCodeUrl: null,
      danfeUrl: null,
      xmlAutorizado: null,
    };

    it('bloqueia reprocessamento quando outro processo ja fez claim', async () => {
      prisma.nfce.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.nfce.findFirst.mockResolvedValueOnce({
        ...unknownNfce,
        status: NfceStatus.PROCESSING,
      });

      await expect(
        service.reprocess(mockNfceId, mockCompanyId),
      ).rejects.toThrow('nao esta disponivel');

      expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
    });

    it('reprocessa usando payload salvo e emissor original', async () => {
      prisma.nfce.findFirst.mockResolvedValueOnce(unknownNfce);
      prisma.invoicyConfig.findFirst.mockResolvedValueOnce({ id: 'config-1' });
      mockFiscalCredentialResolver.resolveOperationalEnvironment.mockResolvedValueOnce(
        'HOMOLOGACAO',
      );
      invoicyApiService.emitNfe.mockResolvedValueOnce([
        {
          Codigo: 100,
          Documentos: [
            {
              DocChaAcesso: 'chave',
              DocProtocolo: 'protocolo',
              DocIDUnico: 'doc-id',
              Situacao: { SitCodigo: 100, SitDescricao: 'Autorizado' },
            },
          ],
        },
      ]);
      prisma.nfce.update.mockResolvedValueOnce({
        ...unknownNfce,
        status: NfceStatus.AUTHORIZED,
      });

      await service.reprocess(mockNfceId, mockCompanyId);

      expect(prisma.nfce.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: mockNfceId,
            companyId: mockCompanyId,
          }),
        }),
      );
      expect(invoicyApiService.emitNfe).toHaveBeenCalledWith(
        mockCompanyId,
        [unknownNfce.invoicyPayloadEnvio],
        'config-1',
      );
    });
  });
});

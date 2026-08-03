import { Test, TestingModule } from '@nestjs/testing';
import { NfeService } from './nfe.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';
import { NfeEmailService } from './nfe-email.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NfceStatus, NfeStatus } from '@prisma/client';

// Mock fetchCepData
jest.mock('../utils/cep.util', () => ({
  fetchCepData: jest.fn().mockResolvedValue({
    codigoIbge: '3550308',
    uf: 'SP',
    cidade: 'São Paulo',
    bairro: 'Centro',
    logradouro: 'Rua Teste',
  }),
}));

// Mock data
const mockCompanyId = 'company-uuid-123';
const mockOrderId = 'order-uuid-456';
const mockNfeId = 'nfe-uuid-789';

const mockOrder = {
  id: mockOrderId,
  companyId: mockCompanyId,
  status: 'COMPLETED',
  items: [
    {
      id: 'item-1',
      product: {
        id: 'product-1',
        name: 'Produto Teste',
        isService: false,
        fiscalData: {
          ncm: '12345678',
          cfopInState: '5102',
          cfopOutState: '6102',
          icmsCst: '00',
          pisCst: '01',
          cofinsCst: '01',
        },
      },
      quantity: 2,
      unitValue: 100,
    },
  ],
  client: {
    id: 'client-1',
    name: 'Cliente Teste',
    document: '12345678901234',
    address: {
      street: 'Rua Teste',
      number: '123',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01234567',
      ibgeCode: '3550308',
    },
  },
  company: {
    id: mockCompanyId,
    name: 'Empresa Teste LTDA',
    document: '12345678000123',
  },
};

const mockCompany = {
  id: mockCompanyId,
  name: 'Empresa Teste LTDA',
  document: '12345678000123',
  address: {
    street: 'Av Empresa',
    number: '456',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01234567',
    ibgeCode: '3550308',
  },
  DigitalCertificate: { id: 'cert-1', type: 'A1' },
  cfopConfigs: [{ code: '5102', description: 'Venda' }],
  operationNatures: [{ id: 'nature-1', description: 'Venda de Mercadoria' }],
};

const mockNfe = {
  id: mockNfeId,
  companyId: mockCompanyId,
  orderId: mockOrderId,
  numero: 1,
  serie: 1,
  status: NfeStatus.DRAFT,
  ambiente: 2,
  valorTotal: 200,
  draftData: {},
};

const mockQuotation = {
  id: 'quotation-uuid-789',
  companyId: mockCompanyId,
  order: mockOrder,
  client: mockOrder.client,
  items: mockOrder.items,
  company: mockCompany,
  quotationProduct: [
    {
      id: 'qp-1',
      productId: 'product-1',
      quantity: 2,
      finalValue: 20000, // cents
      totalValue: 20000,
      product: {
        id: 'product-1',
        name: 'Produto Teste',
        code: 'PROD-001',
        isService: false,
        barcode: null,
        fiscalData: {
          ncm: '12345678',
          cfopInState: '5102',
          cfopOutState: '6102',
          icmsCst: '00',
          pisCst: '01',
          cofinsCst: '01',
          ipiCst: '99',
        },
        measureUnit: 'UN',
      },
    },
  ],
};

const mockInvoicyResponse = [
  {
    Codigo: 100, // INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED
    Descricao: 'Documentos processados com sucesso',
    Documentos: [
      {
        DocChaAcesso: '35260212345678000123550010000000011123456789',
        DocProtocolo: '123456789012345',
        DocIDUnico: 'unique-doc-id',
        DocNumero: 1,
        DocSerie: '1',
        DocModelo: 'NFe',
        Situacao: {
          SitCodigo: 100, // Autorizado
          SitDescricao: 'Autorizado o uso da NF-e',
        },
        DocPDFDownload: 'https://example.com/danfe.pdf',
        DocXMLBase64: '',
      },
    ],
  },
];

const mockCancelResponse = [
  {
    Codigo: 100,
    Descricao: 'Evento processado com sucesso',
    Documentos: [
      {
        DocChaAcesso: '35260212345678000123550010000000011123456789',
        DocProtocolo: '143210987654321',
        Situacao: {
          SitCodigo: 135, // Evento registrado (cancelamento)
          SitDescricao: 'Evento registrado e vinculado a NF-e',
        },
      },
    ],
  },
];

// Mock implementations
const mockPrismaService = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  $executeRaw: jest.fn().mockResolvedValue(1),
  $transaction: jest.fn((callback) => callback(mockPrismaService)),
  order: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
  nfe: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  nfse: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  nfce: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  nfeOrder: {
    createMany: jest.fn(),
  },
  nfeCorrectionEvent: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  nfeDanfeDocument: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  quotation: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  client: {
    findFirst: jest.fn(),
  },
  invoicyConfig: {
    findFirst: jest.fn(),
  },
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  getConfig: jest.fn(),
  incrementNfeNumber: jest.fn(),
};

const mockInvoicyApiService = {
  emitNfe: jest.fn(),
  cancelNfe: jest.fn(),
  getStatusNfe: jest.fn(),
  sendCorrectionLetter: jest.fn(),
};

const mockProductFiscalService = {
  getOrCreateWithDefaults: jest.fn(),
};

const mockNfeEmailService = {
  sendAuthorizedNfeEmail: jest.fn().mockResolvedValue({ success: true }),
};

const mockFiscalCredentialResolver = {
  resolveEnvironmentFromConfig: jest.fn().mockReturnValue('HOMOLOGACAO'),
  assertEnvironmentReady: jest.fn().mockResolvedValue(undefined),
  reserveNfeNumber: jest
    .fn()
    .mockResolvedValue({ reservedNumber: 1, series: 1 }),
};

describe('NfeService', () => {
  let service: NfeService;
  let prisma: typeof mockPrismaService;
  let invoicyService: typeof mockInvoicyService;
  let invoicyApiService: typeof mockInvoicyApiService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyApiService, useValue: mockInvoicyApiService },
        { provide: ProductFiscalService, useValue: mockProductFiscalService },
        { provide: NfeEmailService, useValue: mockNfeEmailService },
        {
          provide: FiscalCredentialResolverService,
          useValue: mockFiscalCredentialResolver,
        },
      ],
    }).compile();

    service = module.get<NfeService>(NfeService);
    prisma = module.get(PrismaService);
    invoicyService = module.get(InvoicyService);
    invoicyApiService = module.get(InvoicyApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated list of NFes', async () => {
      const mockNfes = [mockNfe];
      prisma.nfe.findMany.mockResolvedValue(mockNfes);
      prisma.nfe.count.mockResolvedValue(1);

      const result = await service.findAll(mockCompanyId, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toEqual([
        {
          ...mockNfe,
          destinatario: {
            nome: null,
          },
        },
      ]);
      expect(result.total).toBe(1);
      expect(prisma.nfe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: mockCompanyId },
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.nfe.findMany.mockResolvedValue([]);
      prisma.nfe.count.mockResolvedValue(0);

      await service.findAll(mockCompanyId, { status: NfeStatus.AUTHORIZED });

      expect(prisma.nfe.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: NfeStatus.AUTHORIZED,
          }),
        }),
      );
    });
  });

  describe('findUnified', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.nfe.findMany.mockResolvedValue([]);
      prisma.nfe.count.mockResolvedValue(0);
      prisma.nfse.findMany.mockResolvedValue([]);
      prisma.nfse.count.mockResolvedValue(0);
    });

    it('should include NFC-e linked to an order in unified standalone list', async () => {
      const linkedNfce = {
        id: 'nfce-linked-1',
        companyId: mockCompanyId,
        orderId: mockOrderId,
        quotationId: null,
        numero: 42,
        serie: 1,
        status: NfceStatus.AUTHORIZED,
        createdAt: new Date('2026-06-24T12:00:00.000Z'),
        consumidorNome: null,
        valorTotal: 123.45,
        order: {
          id: mockOrderId,
          quotation: {
            quotationNumber: 1234,
            series: null,
            client: { name: 'Cliente da OS' },
          },
        },
      };

      prisma.nfce.findMany.mockResolvedValue([linkedNfce]);
      prisma.nfce.count.mockResolvedValue(1);

      const result = await service.findUnified(mockCompanyId, {
        page: '1',
        limit: '20',
        recordType: 'NOTAS_AVULSAS',
      });

      expect(prisma.nfce.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ orderId: null }),
          include: {
            order: {
              include: {
                quotation: {
                  include: {
                    client: true,
                    series: true,
                  },
                },
              },
            },
          },
        }),
      );
      expect(prisma.nfce.count).toHaveBeenCalledWith({
        where: expect.not.objectContaining({ orderId: null }),
      });

      const item = result.data[0].items[0];
      expect(item).toMatchObject({
        type: 'NFCE_AVULSA',
        id: linkedNfce.id,
        clientName: 'Cliente da OS',
        reference: 'NFC-e 42 · OS 1234',
        totalValue: 123.45,
      });
    });
  });

  describe('findById', () => {
    it('should return NFe when found', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);

      const result = await service.findById(mockNfeId, mockCompanyId);

      expect(result).toEqual(mockNfe);
      expect(prisma.nfe.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: mockNfeId,
            companyId: mockCompanyId,
          }),
        }),
      );
    });

    it('should throw NotFoundException when NFe not found', async () => {
      prisma.nfe.findFirst.mockResolvedValue(null);

      await expect(
        service.findById('invalid-id', mockCompanyId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('prepareFromOrder', () => {
    beforeEach(() => {
      prisma.quotation.findFirst.mockResolvedValue(mockQuotation);
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
        defaultOperationNature: 'Venda de mercadoria',
        company: mockCompany,
      });
    });

    it('should prepare NFe data from order', async () => {
      const result = await service.prepareFromOrder(mockCompanyId, mockOrderId);

      expect(result).toBeDefined();
      expect(result.orderId).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      expect(prisma.quotation.findFirst).toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.quotation.findFirst.mockResolvedValue(null);

      await expect(
        service.prepareFromOrder(mockCompanyId, 'invalid-order'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should exclude service items from NFe', async () => {
      const orderWithServices = {
        ...mockOrder,
        items: [
          ...mockOrder.items,
          {
            id: 'item-2',
            product: { id: 'service-1', name: 'Serviço', isService: true },
            quantity: 1,
            unitValue: 50,
          },
        ],
      };
      prisma.order.findUnique.mockResolvedValue(orderWithServices);

      const result = await service.prepareFromOrder(mockCompanyId, mockOrderId);

      // Only product items should be included
      expect(result.items.every((item) => !item.isService)).toBe(true);
    });
  });

  describe('prepareDevolution', () => {
    const authorizedXml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe><ide><natOp>Venda</natOp><indFinal>0</indFinal></ide>
<dest><CNPJ>57968205000182</CNPJ><xNome>Cliente Exemplo</xNome><indIEDest>1</indIEDest><IE>250123456</IE>
<enderDest><xLgr>Rua Antônio Jovita Duarte</xLgr><nro>S/N</nro><xBairro>Centro</xBairro>
<cMun>4216602</cMun><xMun>São José</xMun><UF>SC</UF><CEP>88103000</CEP>
<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest></dest>
<det nItem="1"><prod><cProd>PROD-001</cProd><xProd>Produto Teste</xProd><NCM>12345678</NCM>
<CFOP>5102</CFOP><uCOM>UN</uCOM><qCOM>2.0000</qCOM><vUnCom>100.00</vUnCom><vProd>200.00</vProd>
</prod></det></infNFe></NFe></nfeProc>`;

    const authorizedNfe = {
      ...mockNfe,
      status: NfeStatus.AUTHORIZED,
      chaveAcesso: '42260657968205000182550010000000101000005700',
      orderId: null,
      quotationId: null,
      draftData: null,
      xmlAutorizado: authorizedXml,
    };

    beforeEach(() => {
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
        defaultOperationNature: 'Venda de mercadoria',
        company: mockCompany,
      });
      prisma.nfe.findFirst.mockResolvedValue(authorizedNfe);
      prisma.client.findFirst.mockResolvedValue(null);
    });

    it('should keep Brasil (1058) as the recipient country from the authorized XML', async () => {
      const result = await service.prepareDevolution(mockCompanyId, mockNfeId);

      expect(result.destinatario.pais).toBe('1058');
      expect(result.destinatario.cnpjCpf).toBe('57968205000182');
      expect(result.destinatario.estado).toBe('SC');
      expect(result.destinatario.cidade).toBe('São José');
      expect(result.emissao.finalidade).toBe(4);
    });

    it('should carry over the IE indicator from the authorized XML', async () => {
      const result = await service.prepareDevolution(mockCompanyId, mockNfeId);

      expect(result.destinatario.indIEDest).toBe(1);
      expect(result.destinatario.ie).toBe('250123456');
    });

    it('should not let empty XML tags erase draft data', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        draftData: {
          destinatario: {
            razaoSocial: 'Cliente Exemplo',
            cnpjCpf: '57968205000182',
            email: 'contato@cliente.com.br',
            telefone: '48999998888',
            pais: '1058',
          },
        },
      });

      const result = await service.prepareDevolution(mockCompanyId, mockNfeId);

      // O XML não traz <email>/<fone>, então os valores do rascunho devem sobreviver
      expect(result.destinatario.email).toBe('contato@cliente.com.br');
      expect(result.destinatario.telefone).toBe('48999998888');
      expect(result.destinatario.pais).toBe('1058');
    });

    it('should fall back to Brasil when the NF-e has no recipient country', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        xmlAutorizado: null,
        xmlEnvio: null,
        draftData: { destinatario: { razaoSocial: 'Sem país' } },
      });

      const result = await service.prepareDevolution(mockCompanyId, mockNfeId);

      expect(result.destinatario.pais).toBe('1058');
    });

    it('should reject devolution of a NF-e that is not authorized', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.DRAFT,
      });

      await expect(
        service.prepareDevolution(mockCompanyId, mockNfeId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createOrGetDraft', () => {
    beforeEach(() => {
      prisma.quotation.findFirst.mockResolvedValue(mockQuotation);
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
        defaultOperationNature: 'Venda de mercadoria',
        company: mockCompany,
      });
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
      });
    });

    it('should return existing draft if exists', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);

      const result = await service.createOrGetDraft(mockCompanyId, mockOrderId);

      expect(result.draftId).toBe(mockNfeId);
      expect(prisma.nfe.create).not.toHaveBeenCalled();
    });

    it('should create new draft if not exists', async () => {
      prisma.nfe.findFirst.mockResolvedValue(null);
      prisma.nfe.create.mockResolvedValue(mockNfe);

      const result = await service.createOrGetDraft(mockCompanyId, mockOrderId);

      expect(result).toBeDefined();
      expect(prisma.nfe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NfeStatus.DRAFT,
            companyId: mockCompanyId,
          }),
        }),
      );
    });
  });

  describe('updateDraft', () => {
    it('should update draft data', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);
      prisma.nfe.update.mockResolvedValue({
        ...mockNfe,
        draftData: { items: [] },
      });

      const result = await service.updateDraft(mockNfeId, mockCompanyId, {
        items: [],
      });

      expect(result.draftData).toBeDefined();
      expect(prisma.nfe.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if draft not found', async () => {
      prisma.nfe.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDraft('invalid-id', mockCompanyId, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteDraft', () => {
    it('should delete draft', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);
      prisma.nfe.delete.mockResolvedValue(mockNfe);

      await service.deleteDraft(mockCompanyId, mockNfeId);

      expect(prisma.nfe.delete).toHaveBeenCalledWith({
        where: { id: mockNfeId },
      });
    });

    it('should throw if draft not found', async () => {
      prisma.nfe.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteDraft(mockCompanyId, mockNfeId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('emit', () => {
    const mockConfig = {
      id: 'config-id',
      serieNfe: 1,
      proximoNumeroNfe: 1,
      ambiente: 'HOMOLOGACAO',
      isActive: true,
      defaultCfop: '5102',
      ibgeCode: '3550308',
      emitCrt: 1,
      company: {
        cnpj: '12345678000123',
        legalName: 'Empresa Teste LTDA',
        stateRegistration: '123456789',
        address: {
          street: 'Rua Teste',
          number: '100',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          zipcode: '01234567',
        },
      },
    };

    const mockEmitDto = {
      orderId: mockOrderId,
      destNome: 'Cliente Teste',
      destCnpjCpf: '12345678901',
      destEndereco: 'Rua Cliente',
      destNumero: '123',
      destBairro: 'Centro',
      destCep: '01234567',
      destUf: 'SP',
      destMunicipio: 'São Paulo',
      operationNature: 'Venda de mercadoria',
      items: [
        {
          productId: 'product-1',
          description: 'Produto Teste',
          quantity: 2,
          unitValue: 100,
          ncm: '12345678',
          cfop: 5102,
        },
      ],
    };

    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue(null); // Sem conflito de chave
      prisma.nfe.create.mockResolvedValue({
        id: mockNfeId,
        companyId: mockCompanyId,
        orderId: mockOrderId,
        numero: 1,
        serie: 1,
        status: NfeStatus.PROCESSING,
        ambiente: 2,
        valorTotal: 200,
      });
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      invoicyService.getConfig.mockResolvedValue(mockConfig);
      invoicyApiService.emitNfe.mockResolvedValue(mockInvoicyResponse);
      prisma.nfe.update.mockResolvedValue({
        ...mockNfe,
        status: NfeStatus.AUTHORIZED,
        chaveAcesso: mockInvoicyResponse[0].Documentos[0].DocChaAcesso,
      });
    });

    it('should emit NFe successfully', async () => {
      const result = await service.emit(mockCompanyId, mockEmitDto);

      expect(result.status).toBe(NfeStatus.AUTHORIZED);
      expect(result.chaveAcesso).toBeDefined();
      expect(invoicyApiService.emitNfe).toHaveBeenCalled();
      // O número é reservado atomicamente ANTES de transmitir, por ambiente.
      // O incremento pós-autorização foi removido: mantê-lo pularia um número
      // a cada emissão, agora que a reserva já incrementa.
      expect(
        mockFiscalCredentialResolver.reserveNfeNumber,
      ).toHaveBeenCalledWith(expect.anything(), 'config-id', 'HOMOLOGACAO');
      expect(invoicyService.incrementNfeNumber).not.toHaveBeenCalled();
    });

    it('should throw if items are empty', async () => {
      await expect(
        service.emit(mockCompanyId, { ...mockEmitDto, items: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle Invoicy failure', async () => {
      invoicyApiService.emitNfe.mockResolvedValue([
        { Codigo: 225, Descricao: 'Rejeitado pela SEFAZ' },
      ]);

      await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    const authorizedNfe = {
      ...mockNfe,
      status: NfeStatus.AUTHORIZED,
      chaveAcesso: '35260212345678000123550010000000011123456789',
      dataEmissao: new Date(), // Dentro do prazo de 24h
    };

    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue(authorizedNfe);
      invoicyApiService.cancelNfe.mockResolvedValue(mockCancelResponse);
      prisma.nfe.update.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CANCELLED,
      });
    });

    it('should cancel authorized NFe', async () => {
      const result = await service.cancel(mockNfeId, mockCompanyId, {
        justificativa: 'Cancelamento por erro de digitação no documento',
      });

      expect(result.status).toBe(NfeStatus.CANCELLED);
      expect(invoicyApiService.cancelNfe).toHaveBeenCalled();
    });

    it('should throw if NFe is not authorized', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe); // DRAFT status

      await expect(
        service.cancel(mockNfeId, mockCompanyId, {
          justificativa: 'Teste cancelamento de documento',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should require minimum 15 characters justification', async () => {
      await expect(
        service.cancel(mockNfeId, mockCompanyId, {
          justificativa: 'curto',
        }),
      ).rejects.toThrow();
    });
  });

  describe('getDanfeUrl', () => {
    it('should return the persisted PDF instead of relying on the external URL', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...mockNfe,
        danfeUrl: 'https://example.com/danfe.pdf',
      });
      prisma.nfeDanfeDocument.findUnique.mockResolvedValue({
        nfeId: mockNfeId,
        pdf: Buffer.from('%PDF-test'),
      });

      const result = await service.getDanfeUrl(mockNfeId, mockCompanyId);

      expect(result.pdfBase64).toBe(
        Buffer.from('%PDF-test').toString('base64'),
      );
      expect(result.url).toBe('https://example.com/danfe.pdf');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { NfeService } from './nfe.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';
import { NfeEmailService } from './nfe-email.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { IcmsAliquotaInternaService } from '../shared/icms-aliquota-interna.service';
import {
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    // Vazio por padrao: assertOrdersNotCanceled consulta ordens canceladas
    // antes de preparar/emitir e so bloqueia quando encontra alguma.
    findMany: jest.fn().mockResolvedValue([]),
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
  nfeCorrectionDocument: {
    upsert: jest.fn(),
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
    // A emissão cacheia aqui o IBGE do emitente; a pré-visualização não pode.
    update: jest.fn(),
  },
  operationNature: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  productFiscalData: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  productStRule: {
    findMany: jest.fn().mockResolvedValue([]),
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
  consultDocumentEvents: jest.fn(),
  consultDocumentXml: jest.fn(),
  consultNfeSefaz: jest.fn(),
};

const mockProductFiscalService = {
  getOrCreateWithDefaults: jest.fn(),
};

const mockNfeEmailService = {
  sendAuthorizedNfeEmail: jest.fn().mockResolvedValue({ success: true }),
};

const mockIcmsAliquotaInterna = {
  resolver: jest.fn().mockResolvedValue(18),
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
        {
          provide: IcmsAliquotaInternaService,
          useValue: mockIcmsAliquotaInterna,
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
      prisma.nfce.findMany.mockResolvedValue([]);
      prisma.nfce.count.mockResolvedValue(0);
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);
      // clearAllMocks preserva implementações, então um teste que troque o
      // ambiente do emissor vazaria para os seguintes sem este reset.
      mockFiscalCredentialResolver.resolveEnvironmentFromConfig.mockReturnValue(
        'HOMOLOGACAO',
      );
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

    /**
     * Produção e homologação apareciam misturadas na mesma lista, sem forma de
     * separar. O filtro é aplicado no where (não em memória) porque a
     * paginação usa os counts do banco.
     */
    describe('filtro de ambiente', () => {
      it('aplica o ambiente nas notas avulsas', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'NOTAS_AVULSAS',
          ambiente: '2',
        });

        for (const model of ['nfe', 'nfse', 'nfce'] as const) {
          expect(prisma[model].findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ ambiente: 2 }),
            }),
          );
          expect(prisma[model].count).toHaveBeenCalledWith({
            where: expect.objectContaining({ ambiente: 2 }),
          });
        }
      });

      it('não filtra ambiente quando o valor é ausente ou inválido', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'NOTAS_AVULSAS',
          ambiente: 'PRODUCAO',
        });

        expect(prisma.nfe.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ ambiente: expect.anything() }),
          }),
        );
      });

      /**
       * Os branches de status dos pedidos atribuem orderWhere.AND diretamente.
       * Aplicar o ambiente antes deles — ou por atribuição — apagaria o filtro
       * de status silenciosamente.
       */
      it('combina ambiente e status no pedido sem descartar nenhum dos dois', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'NAO_EMITIDA',
          ambiente: '2',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];

        // O AND do status permanece...
        expect(where.AND).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              nfes: { none: expect.objectContaining({ ambiente: 2 }) },
            }),
          ]),
        );
        // ...e o OR de ambiente foi empilhado ao lado dele.
        expect(where.AND).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { nfes: { some: { ambiente: 2 } } },
                { nfeOrders: { some: { nfe: { ambiente: 2 } } } },
                { nfses: { some: { ambiente: 2 } } },
              ]),
            }),
          ]),
        );
        expect(where.status).toEqual({ not: 'CANCELED' });
      });

      it('mantém na lista o pedido que ainda não tem documento algum', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          ambiente: '1',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];
        const ambienteClause = where.AND.find((clause: any) => clause.OR);

        expect(ambienteClause.OR).toEqual(
          expect.arrayContaining([
            {
              AND: [
                { nfes: { none: {} } },
                { nfeOrders: { none: {} } },
                { nfses: { none: {} } },
              ],
            },
          ]),
        );
      });

      /**
       * Sem isto, filtrar homologação com o emissor ativo em produção devolveria
       * pedidos já emitidos marcados como "não emitida": o status olharia um
       * ambiente e o filtro, outro.
       */
      it('resolve o status dos pedidos pelo ambiente filtrado, não pelo ativo', async () => {
        mockFiscalCredentialResolver.resolveEnvironmentFromConfig.mockReturnValue(
          'PRODUCAO',
        );

        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'EMITIDA',
          ambiente: '2',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];
        expect(where.OR).toEqual(
          expect.arrayContaining([
            {
              nfes: {
                some: {
                  // "Emitida" inclui a nota que recebeu CC-e.
                  status: { in: ['AUTHORIZED', 'CORRECTION_SENT'] },
                  ambiente: 2,
                },
              },
            },
          ]),
        );
      });

      it('só considera os tipos de documento da aba ativa', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          docType: 'NFSE',
          ambiente: '2',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];
        const ambienteClause = where.AND.find((clause: any) => clause.OR);

        expect(ambienteClause.OR).toEqual(
          expect.arrayContaining([{ nfses: { some: { ambiente: 2 } } }]),
        );
        expect(ambienteClause.OR).not.toEqual(
          expect.arrayContaining([{ nfes: { some: { ambiente: 2 } } }]),
        );
      });
    });

    /**
     * A opcao "Cancelada" existia na tela antiga de gestao e se perdeu quando
     * ela foi integrada a' tela de emissao. O backend ja' respondia por este
     * status nas avulsas; faltava a opcao no seletor e o branch dos pedidos
     * procurava a coisa errada.
     */
    describe('filtro de canceladas', () => {
      it('filtra as notas avulsas pelo status cancelado', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'NOTAS_AVULSAS',
          status: 'CANCELADA',
        });

        for (const model of ['nfe', 'nfse', 'nfce'] as const) {
          expect(prisma[model].findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ status: 'CANCELLED' }),
            }),
          );
          // O count usa o mesmo where: sem isso a paginacao conta outra coisa.
          expect(prisma[model].count).toHaveBeenCalledWith({
            where: expect.objectContaining({ status: 'CANCELLED' }),
          });
        }
      });

      /**
       * Cancelar a NF-e de uma O.S. nao cancela a O.S.. O branch antigo
       * filtrava `order.status = 'CANCELED'`, entao justamente o caso comum
       * ficava fora da lista — e entravam vendas canceladas sem nota nenhuma.
       */
      it('acha o pedido pelo documento cancelado, nao pelo pedido cancelado', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'CANCELADA',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];

        expect(where.OR).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              nfes: { some: expect.objectContaining({ status: 'CANCELLED' }) },
            }),
            expect.objectContaining({
              nfses: { some: expect.objectContaining({ status: 'CANCELLED' }) },
            }),
          ]),
        );
        expect(where.status).toBeUndefined();
      });

      it('respeita o ambiente filtrado ao procurar o documento cancelado', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'CANCELADA',
          ambiente: '1',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];
        expect(where.OR).toEqual(
          expect.arrayContaining([
            { nfes: { some: { status: 'CANCELLED', ambiente: 1 } } },
          ]),
        );
      });
    });

    /**
     * A NFS-e consolidada cobre varias O.S.. A lista mostrava uma linha por
     * ordem: so' a principal dizia "Emitida", as demais diziam "Nao emitida",
     * e o valor exibido era o da ordem (R$ 12,00), nao o da nota (R$ 165,00).
     */
    describe('NFS-e consolidada na listagem', () => {
      const notaConsolidada = {
        id: 'nfse-consolidada-1',
        numero: 171,
        serie: '1',
        status: 'AUTHORIZED',
        valorServicos: 165,
        createdAt: new Date('2026-11-03T11:17:35.000Z'),
        nfseOrders: [
          { orderId: 'order-1' },
          { orderId: 'order-2' },
          { orderId: 'order-3' },
        ],
      };

      const ordemDaConsolidada = (id: string, numero: number) => ({
        id,
        createdAt: new Date('2026-10-28T12:00:00.000Z'),
        status: 'FINISHED',
        quotation: {
          quotationNumber: numero,
          totalValue: 1200,
          series: { code: 'Si' },
          client: { name: 'SYS MANAGER' },
        },
        nfes: [],
        nfeOrders: [],
        nfses: [],
        nfseOrders: [{ nfse: notaConsolidada }],
      });

      const tresOrdens = () => {
        prisma.order.findMany.mockResolvedValue([
          ordemDaConsolidada('order-1', 226851),
          ordemDaConsolidada('order-2', 226852),
          ordemDaConsolidada('order-3', 226853),
        ]);
        prisma.order.count.mockResolvedValue(3);
      };

      const itensDe = (result: any) =>
        result.data.flatMap((grupo: any) => grupo.items);

      /**
       * `clearAllMocks` zera chamadas, nao implementacoes: um
       * `mockResolvedValue` daqui continuaria valendo nos describes seguintes,
       * que esperam a lista vazia do beforeEach de findUnified.
       */
      afterEach(() => {
        prisma.order.findMany.mockResolvedValue([]);
        prisma.order.count.mockResolvedValue(0);
      });

      it('agrupa as ordens numa entrada só, com o valor da nota', async () => {
        tresOrdens();

        const result = await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
        });

        const itens = itensDe(result);
        expect(itens).toHaveLength(1);
        expect(itens[0]).toMatchObject({
          type: 'NFSE_CONSOLIDADA',
          id: 'nfse-consolidada-1',
          status: 'AUTHORIZED',
          totalValue: 165,
          clientName: 'SYS MANAGER',
          consolidatedOrderCount: 3,
        });
        expect(itens[0].reference).toBe('NFS-e 171 · 3 O.S.');
      });

      it('lista as O.S. cobertas para a tela não perder o rastro delas', async () => {
        tresOrdens();

        const result = await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
        });

        expect(
          itensDe(result)[0].consolidatedOrders.map((o: any) => o.reference),
        ).toEqual(['Si-226851', 'Si-226852', 'Si-226853']);
      });

      /**
       * Tres ordens viram uma linha: sem descontar, a paginacao prometia
       * paginas que vinham vazias.
       */
      it('desconta do total as ordens absorvidas pela consolidada', async () => {
        tresOrdens();

        const result = await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
        });

        expect(result.total).toBe(1);
      });

      /**
       * Nota de uma O.S. so' nao e' consolidacao: a ordem segue como linha
       * propria, com o valor dela.
       */
      it('não agrupa quando a nota cobre uma única ordem', async () => {
        const notaSimples = {
          ...notaConsolidada,
          id: 'nfse-simples',
          nfseOrders: [{ orderId: 'order-9' }],
        };
        prisma.order.findMany.mockResolvedValue([
          {
            ...ordemDaConsolidada('order-9', 226900),
            nfses: [notaSimples],
            nfseOrders: [{ nfse: notaSimples }],
          },
        ]);
        prisma.order.count.mockResolvedValue(1);

        const result = await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
        });

        const item = itensDe(result)[0];
        expect(item.type).toBe('ORDER');
        expect(item.totalValue).toBe(12);
      });
    });

    /**
     * "Rejeitada" tinha o mesmo buraco de "Cancelada", e pior: as avulsas
     * vinham filtradas e os pedidos voltavam sem filtro algum, porque o valor
     * caia no fim da cadeia de branches.
     */
    describe('filtro de rejeitadas', () => {
      it('filtra as notas avulsas pelo status rejeitado', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'NOTAS_AVULSAS',
          status: 'REJEITADA',
        });

        for (const model of ['nfe', 'nfse', 'nfce'] as const) {
          expect(prisma[model].findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ status: 'REJECTED' }),
            }),
          );
        }
      });

      it('filtra tambem os pedidos, em vez de devolver a lista inteira', async () => {
        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'REJEITADA',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];

        expect(where.OR).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              nfes: { some: expect.objectContaining({ status: 'REJECTED' }) },
            }),
            expect.objectContaining({
              nfses: { some: expect.objectContaining({ status: 'REJECTED' }) },
            }),
          ]),
        );
      });

      /**
       * Rejeicao que ja' ganhou uma versao autorizada depois esta' resolvida;
       * mante-la no filtro mandaria o usuario conferir um problema que nao
       * existe mais. E' a mesma exclusao que a lista de avulsas aplica.
       */
      it('ignora a rejeicao que ja tem versao autorizada posterior', async () => {
        prisma.$queryRaw.mockResolvedValue([
          { id: 'nfe-rejeitada-substituida' },
        ]);

        await service.findUnified(mockCompanyId, {
          recordType: 'PEDIDOS',
          status: 'REJEITADA',
        });

        const { where } = prisma.order.findMany.mock.calls[0][0];
        expect(where.OR).toEqual(
          expect.arrayContaining([
            {
              nfes: {
                some: expect.objectContaining({
                  id: { notIn: ['nfe-rejeitada-substituida'] },
                }),
              },
            },
          ]),
        );
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
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
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

    /**
     * A O.S. #6-T1 aprovou 14 m² e a nota saía com quantidade 1: a NF-e lia
     * QuotationProduct.quantity ("Qtd. Item") e a relação `items`, onde mora a
     * medida, nunca era carregada.
     */
    describe('quantidade comercial', () => {
      const comMedida = (over = {}) => ({
        ...mockQuotation,
        quotationProduct: [
          {
            ...mockQuotation.quotationProduct[0],
            quantity: 1,
            finalValue: 50, // R$ 0,50 em centavos
            totalValue: 50,
            items: [
              {
                quantity: 14,
                unitKind: 'AREA',
                width: 1000,
                height: 1000,
              },
            ],
            ...over,
          },
        ],
      });

      it('usa a medida do item, não a "Qtd. Item"', async () => {
        prisma.quotation.findFirst.mockResolvedValue(comMedida());

        const result = await service.prepareFromOrder(
          mockCompanyId,
          mockOrderId,
        );

        expect(result.items[0].quantity).toBe(14);
        expect(result.items[0].unit).toBe('M2');
        // A tela lê `unit`, o payload de emissão lê `uCom`: os dois precisam
        // sair do prepare, senão a nota mostra M2 e é transmitida como UN.
        expect(result.items[0].uCom).toBe('M2');
      });

      /**
       * O payload monta vProd como qCOM x vUnCom. Arredondar o unitário para 2
       * casas fazia 14 x 0,04 = 0,56 divergir do total da nota (0,50) — soma
       * dos itens diferente do total é rejeição na SEFAZ.
       */
      it('mantém precisão no unitário para vProd fechar com o total', async () => {
        prisma.quotation.findFirst.mockResolvedValue(comMedida());

        const result = await service.prepareFromOrder(
          mockCompanyId,
          mockOrderId,
        );

        const item = result.items[0];
        expect(item.unitValue).toBeCloseTo(0.5 / 14, 10);

        const vProd = Number((item.quantity * item.unitValue).toFixed(2));
        expect(vProd).toBe(0.5);
        expect(vProd).toBe(item.totalValue);
      });

      it('produto composto sai como unidade montada', async () => {
        prisma.quotation.findFirst.mockResolvedValue(
          comMedida({
            quantity: 3,
            items: [
              { quantity: 1, unitKind: 'AREA', width: 2000, height: 1000 },
              { quantity: 2, unitKind: 'WEIGHT', weight: 250000 },
            ],
          }),
        );

        const result = await service.prepareFromOrder(
          mockCompanyId,
          mockOrderId,
        );

        expect(result.items[0].quantity).toBe(3);
        expect(result.items[0].unit).toBe('UN');
      });
    });

    /**
     * A tela esconde o botao de emitir quando a ordem ja tem nota, exceto se
     * ela estiver em DRAFT/REJECTED/CANCELLED. Como a escolha era um `.find()`
     * sem filtro nem ordenacao, uma ordem com nota cancelada + rascunho podia
     * devolver a cancelada e o cliente ficava sem como emitir.
     */
    describe('qual nota da ordem e considerada existente', () => {
      const nfeDaOrdem = (over = {}) => ({
        id: 'nfe-x',
        numero: 1,
        serie: 1,
        status: NfeStatus.DRAFT,
        ambiente: 2,
        chaveAcesso: null,
        danfeUrl: null,
        dataEmissao: null,
        createdAt: new Date('2026-10-29T10:00:00Z'),
        ...over,
      });

      const comNfes = (nfes) =>
        prisma.quotation.findFirst.mockResolvedValue({
          ...mockQuotation,
          order: { ...mockOrder, nfes, nfeOrders: [] },
        });

      it('prefere a mais recente quando ha cancelada e rascunho', async () => {
        comNfes([
          nfeDaOrdem({
            id: 'cancelada',
            numero: 785,
            status: NfeStatus.CANCELLED,
            createdAt: new Date('2026-10-29T13:24:00Z'),
          }),
          nfeDaOrdem({
            id: 'rascunho',
            numero: 786,
            status: NfeStatus.DRAFT,
            createdAt: new Date('2026-10-29T14:02:00Z'),
          }),
        ]);

        const result = await service.prepareFromOrder(
          mockCompanyId,
          mockOrderId,
        );

        expect(result.existingNfe.id).toBe('rascunho');
      });

      it('prefere a autorizada, que e a que impede nova emissao', async () => {
        comNfes([
          nfeDaOrdem({
            id: 'rascunho',
            status: NfeStatus.DRAFT,
            createdAt: new Date('2026-10-29T14:02:00Z'),
          }),
          nfeDaOrdem({
            id: 'autorizada',
            status: NfeStatus.AUTHORIZED,
            createdAt: new Date('2026-10-29T09:00:00Z'),
          }),
        ]);

        const result = await service.prepareFromOrder(
          mockCompanyId,
          mockOrderId,
        );

        expect(result.existingNfe.id).toBe('autorizada');
      });
    });

    it('usa a descrição editada do item no lugar do nome do produto', async () => {
      prisma.quotation.findFirst.mockResolvedValue({
        ...mockQuotation,
        quotationProduct: [
          {
            ...mockQuotation.quotationProduct[0],
            description: 'SERVIÇOS',
          },
        ],
      });

      const result = await service.prepareFromOrder(mockCompanyId, mockOrderId);

      expect(result.items[0].description).toBe('SERVIÇOS');
    });

    it('cai para o nome do produto quando o item não tem descrição', async () => {
      const result = await service.prepareFromOrder(mockCompanyId, mockOrderId);

      expect(result.items[0].description).toBe('Produto Teste');
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

    it('recusa preparar NF-e de ordem cancelada', async () => {
      prisma.order.findMany.mockResolvedValueOnce([
        {
          id: mockOrderId,
          status: 'CANCELED',
          quotation: { quotationNumber: 2, series: { code: 'T1' } },
        },
      ]);

      await expect(
        service.prepareFromOrder(mockCompanyId, mockOrderId),
      ).rejects.toThrow('T1-2');
      expect(prisma.quotation.findFirst).not.toHaveBeenCalled();
    });
  });

  /**
   * "Corrigir e reemitir" partia do zero: `emit` grava o DTO PLANO em
   * `draftData`, mas o prepare só sabia ler o rascunho ANINHADO. Tudo que o
   * usuário tinha digitado — informações complementares à frente — voltava com
   * o padrão do emissor, e ele redigitava a cada rejeição.
   */
  describe('prepareReissue', () => {
    const rejeitadaCom = (draftData: any) => ({
      id: 'nfe-rejeitada',
      companyId: mockCompanyId,
      numero: 703,
      status: NfeStatus.REJECTED,
      motivoRejeicao: 'Rejeicao: Consumo Indevido',
      draftData,
      xmlEnvio: null,
      xmlAutorizado: null,
    });

    beforeEach(() => {
      prisma.quotation.findFirst.mockResolvedValue(mockQuotation);
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.client.findFirst.mockResolvedValue(null);
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        serieNfe: 1,
        proximoNumeroNfe: 1,
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
        ambiente: 2,
        taxInfoText: 'Texto padrão do emissor',
        defaultOperationNature: 'Venda de mercadoria',
        company: mockCompany,
      });
    });

    it('preserva as informações complementares digitadas antes da rejeição', async () => {
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({ additionalInfo: 'Pedido 4821 - entregar na portaria' }),
      );

      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      expect(result.informacoesComplementares).toBe(
        'Pedido 4821 - entregar na portaria',
      );
    });

    it('preserva o cabeçalho da emissão do DTO plano', async () => {
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({
          operationNature: 'Remessa para conserto',
          finalidade: 4,
          presencaConsumidor: 9,
        }),
      );

      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      expect(result.emissao.operationNature).toBe('Remessa para conserto');
      expect(result.emissao.finalidade).toBe(4);
      expect(result.emissao.presencaConsumidor).toBe(9);
    });

    it('mantém o padrão do emissor no que o usuário não informou', async () => {
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({ operationNature: 'Remessa para conserto' }),
      );

      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      // `finalidade` não veio no envio: nao pode virar undefined.
      expect(result.emissao.finalidade).toBe(1);
      expect(result.informacoesComplementares).toBe('Texto padrão do emissor');
    });

    /**
     * Restaurar a data de saida guardada trazia de volta um instante ja vencido
     * e a nota era rejeitada de novo pela 505. O prepare repoe o instante atual.
     */
    it('nao restaura data de saida ja vencida', async () => {
      const vencida = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({ dataSaida: vencida }),
      );

      const antesDaChamada = Date.now();
      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      expect(result.emissao.dataSaida).not.toBe(vencida);
      expect(
        new Date(result.emissao.dataSaida).getTime(),
      ).toBeGreaterThanOrEqual(antesDaChamada);
    });

    it('preserva data de saida futura informada antes da rejeicao', async () => {
      const futura = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({ dataSaida: futura }),
      );

      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      expect(result.emissao.dataSaida).toBe(futura);
    });

    it('continua lendo o rascunho aninhado', async () => {
      prisma.nfe.findFirst.mockResolvedValue(
        rejeitadaCom({
          emissao: { operationNature: 'Venda aninhada' },
          informacoesComplementares: 'Observação do rascunho',
        }),
      );

      const result = await service.prepareReissue(
        mockCompanyId,
        'nfe-rejeitada',
      );

      expect(result.emissao.operationNature).toBe('Venda aninhada');
      expect(result.informacoesComplementares).toBe('Observação do rascunho');
    });
  });

  /**
   * A tela mostrava "1 - Operacao interna" em nota que saia interestadual no
   * XML: a avulsa devolvia 1 fixo e o XML calculava pela UF. Agora a regra e
   * uma so.
   */
  describe('destino da operacao', () => {
    const configComEmitenteEmSP = () =>
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        serieNfe: 1,
        proximoNumeroNfe: 1,
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
        ambiente: 2,
        company: mockCompany, // address.state = 'SP'
      });

    const clienteNaUf = (state: string) =>
      prisma.client.findFirst.mockResolvedValue({
        id: 'client-1',
        name: 'Cliente Teste',
        address: [
          {
            id: 'addr-1',
            type: 'Principal',
            street: 'Rua Teste',
            number: '1',
            neighborhood: 'Centro',
            city: 'Cidade',
            state,
            zipcode: '01234567',
          },
        ],
      });

    it('avulsa para outra UF sai como interestadual, nao mais 1 fixo', async () => {
      configComEmitenteEmSP();
      clienteNaUf('RJ');

      const result = await service.prepareStandalone(mockCompanyId, 'client-1');

      expect(result.emissao.destinoOperacao).toBe(2);
    });

    it('avulsa para a mesma UF do emitente sai como interna', async () => {
      configComEmitenteEmSP();
      clienteNaUf('SP');

      const result = await service.prepareStandalone(mockCompanyId, 'client-1');

      expect(result.emissao.destinoOperacao).toBe(1);
    });

    it('sem destinatario assume interna, pois nao da para afirmar o contrario', async () => {
      configComEmitenteEmSP();

      const result = await service.prepareStandalone(mockCompanyId);

      expect(result.emissao.destinoOperacao).toBe(1);
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
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
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

    it('deve permitir devolucao de NF-e que recebeu carta de correcao', async () => {
      // CC-e e devolucao sao procedimentos independentes: a carta corrige dados
      // da nota original, a devolucao e' uma nota nova que a referencia.
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CORRECTION_SENT,
      });

      const result = await service.prepareDevolution(mockCompanyId, mockNfeId);

      expect(result.originalNfeChave).toBe(authorizedNfe.chaveAcesso);
    });

    it('deve continuar recusando devolucao de NF-e cancelada', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CANCELLED,
      });

      await expect(
        service.prepareDevolution(mockCompanyId, mockNfeId),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve permitir NF-e complementar de nota que recebeu carta de correcao', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CORRECTION_SENT,
      });

      const result = await service.prepareComplementary(
        mockCompanyId,
        mockNfeId,
      );

      expect(result.originalNfeChave).toBe(authorizedNfe.chaveAcesso);
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
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
        ambiente: 2,
        defaultOperationNature: 'Venda de mercadoria',
        company: mockCompany,
      });
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfe: 1,
        proximoNumeroNfe: 1,
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
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

    it('nao cria rascunho quando a ordem ja tem NF-e com carta de correcao', async () => {
      // CORRECTION_SENT e' nota valida: liberar um rascunho novo aqui abriria
      // caminho para uma segunda NF-e autorizada na mesma O.S.
      prisma.nfe.findFirst.mockResolvedValue({
        ...mockNfe,
        status: NfeStatus.CORRECTION_SENT,
        orders: [{ orderId: mockOrderId }],
      });

      await expect(
        service.createOrGetDraft(mockCompanyId, mockOrderId),
      ).rejects.toThrow('ja esta vinculada a uma NF-e consolidada');

      expect(prisma.nfe.create).not.toHaveBeenCalled();
    });
  });

  describe('emitFromOrder', () => {
    it('recusa emissao quando a ordem ja tem NF-e com carta de correcao', async () => {
      prisma.quotation.findFirst.mockResolvedValue(mockQuotation);
      invoicyService.getConfig.mockResolvedValue({
        id: 'config-id',
        ambiente: 2,
        company: mockCompany,
      });
      // Guarda de duplicidade: a nota corrigida precisa continuar bloqueando.
      prisma.nfe.findFirst.mockResolvedValue({
        ...mockNfe,
        numero: 7,
        serie: 1,
        status: NfeStatus.CORRECTION_SENT,
      });

      await expect(
        service.emitFromOrder(mockCompanyId, { orderId: mockOrderId } as any),
      ).rejects.toThrow(/existe uma NF-e autorizada para esta ordem/);

      expect(mockInvoicyApiService.emitNfe).not.toHaveBeenCalled();
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
      activeNumbering: {
        nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
        nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
        nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
      },
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

    /**
     * A prévia roda o mesmo montador da emissão. Se alguém acrescentar uma
     * regra só no `emit`, a nota passa a sair diferente do que o usuário
     * conferiu — e é este teste que quebra.
     */
    describe('preview', () => {
      beforeEach(() => {
        prisma.productFiscalData.findMany.mockResolvedValue([]);
        prisma.productStRule.findMany.mockResolvedValue([]);
        // dhEmi vem de `new Date()`: sem relógio fixo, prévia e emissão
        // diferem por milissegundos e a comparação perde o sentido.
        jest.useFakeTimers().setSystemTime(new Date('2026-09-08T12:00:00Z'));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      const payloadEmitido = () =>
        invoicyApiService.emitNfe.mock.calls.at(-1)[1][0];

      it.each([
        ['Simples Nacional', { emitCrt: 1 }],
        ['Regime Normal', { emitCrt: 3 }],
        [
          'Reforma Tributária ativa',
          { emitCrt: 3, reformaTributariaAtiva: true },
        ],
      ])(
        'gera payload idêntico ao da emissão — %s',
        async (_titulo, extraConfig) => {
          invoicyService.getConfig.mockResolvedValue({
            ...mockConfig,
            ...extraConfig,
          });
          prisma.productFiscalData.findMany.mockResolvedValue([
            {
              productId: 'product-1',
              ncm: '12345678',
              icmsCst: '00',
              icmsRate: 18,
              pisCst: '01',
              pisRate: 1.65,
              cofinsCst: '01',
              cofinsRate: 7.6,
              // Exigidos quando a Reforma está ativa.
              cstIbsCbs: '000',
              codClassificacao: '000001',
            },
          ]);

          const previa = await service.preview(mockCompanyId, mockEmitDto);
          await service.emit(mockCompanyId, mockEmitDto);

          expect(previa.payloadInvoicy).toEqual(payloadEmitido());
        },
      );

      it('não reserva número, não cria registro e não chama o provedor', async () => {
        await service.preview(mockCompanyId, mockEmitDto);

        expect(
          mockFiscalCredentialResolver.reserveNfeNumber,
        ).not.toHaveBeenCalled();
        expect(prisma.nfe.create).not.toHaveBeenCalled();
        expect(prisma.nfe.update).not.toHaveBeenCalled();
        expect(prisma.nfeOrder.createMany).not.toHaveBeenCalled();
        expect(prisma.invoicyConfig.update).not.toHaveBeenCalled();
        expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
      });

      it('usa o próximo número do emissor e avisa que ele é previsto', async () => {
        const previa = await service.preview(mockCompanyId, mockEmitDto);

        expect(previa.documento?.numeroPrevisto).toBe(
          mockConfig.activeNumbering.nfe.nextNumber,
        );
        expect(previa.avisos.join(' ')).toMatch(/previsto/i);
      });

      /**
       * A prévia abre mesmo com a nota inválida: é para isso que ela serve.
       * Quem lança é o emit.
       */
      it('devolve os bloqueios em vez de lançar quando a nota não pode sair', async () => {
        const semNcm = {
          ...mockEmitDto,
          items: [{ ...mockEmitDto.items[0], ncm: '' }],
        };

        const previa = await service.preview(mockCompanyId, semNcm);

        expect(previa.podeEmitir).toBe(false);
        expect(previa.bloqueios.join(' ')).toMatch(/NCM/i);
        expect(previa.payloadInvoicy).toBeUndefined();

        // O mesmo DTO continua sendo recusado na emissão.
        await expect(service.emit(mockCompanyId, semNcm)).rejects.toThrow();
      });

      it('avisa sobre a substituição do destinatário em homologação', async () => {
        const previa = await service.preview(mockCompanyId, mockEmitDto);

        expect(previa.avisos.join(' ')).toMatch(/homologação/i);
        expect(previa.destinatario?.xNome_dest).toMatch(/SEM VALOR FISCAL/);
      });
    });

    /**
     * A ramificação por regime é o que garante que ligar o motor não altera
     * nenhuma nota em produção: todos os emissores de hoje são Simples.
     */
    describe('Regime Normal x Simples Nacional', () => {
      // clearAllMocks limpa chamadas, não implementações: sem este reset a
      // regra de ST de um teste vaza para o seguinte.
      beforeEach(() => {
        prisma.productFiscalData.findMany.mockResolvedValue([]);
        prisma.productStRule.findMany.mockResolvedValue([]);
      });

      const comRegime = (
        emitCrt: number,
        extra: Record<string, unknown> = {},
      ) =>
        invoicyService.getConfig.mockResolvedValue({
          ...mockConfig,
          emitCrt,
          ...extra,
        });

      const impostoEnviado = () =>
        invoicyApiService.emitNfe.mock.calls.at(-1)[1][0].Documento.det[0]
          .imposto;
      const totaisEnviados = () =>
        invoicyApiService.emitNfe.mock.calls.at(-1)[1][0].Documento.total
          .ICMStot;

      it('mantém apenas os códigos e totais zerados no Simples Nacional', async () => {
        comRegime(1);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado().ICMS).toEqual({ orig: 0, CST: '102' });
        expect(impostoEnviado().ICMS).not.toHaveProperty('vICMS_icms');
        expect(totaisEnviados().vICMS_ttlnfe).toBe('0.00');
        // O cadastro fiscal sequer é consultado nesse caminho.
        expect(prisma.productFiscalData.findMany).not.toHaveBeenCalled();
      });

      /**
       * O grupo de IPI exige `cEnq` e o CST dentro de `CSTIPI`. O caminho do
       * Simples enviava `CST_ipi` solto — campo que nao existe no schema — e
       * o grupo ia sem os dois filhos obrigatorios.
       */
      it('envia o IPI no formato do schema tambem no Simples', async () => {
        comRegime(1);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado().IPI).toEqual({
          cEnq: '999',
          CSTIPI: { CST_IPI: '99' },
        });
        expect(impostoEnviado().IPI).not.toHaveProperty('CST_ipi');
      });

      /**
       * A Reforma so' trafega no layout paralelo do provedor. Sem ativacao,
       * nada de IBS/CBS sai — nem grupo no item, nem totalizador.
       */
      it('nao envia IBS/CBS enquanto a Reforma nao esta ativa', async () => {
        comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '00',
            icmsOrigin: '0',
            icmsRate: 18,
            pisCst: '01',
            pisRate: 1.65,
            cofinsCst: '01',
            cofinsRate: 7.6,
            cstIbsCbs: '000',
            codClassificacao: '000001',
          },
        ]);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado()).not.toHaveProperty('IBSCBS');
        const total =
          invoicyApiService.emitNfe.mock.calls.at(-1)[1][0].Documento.total;
        expect(total).not.toHaveProperty('IBSCBSTot');
        expect(total).not.toHaveProperty('vNFIBScbsIS');
      });

      it('envia IBS/CBS quando a Reforma esta ativa para o emissor', async () => {
        comRegime(3, { reformaTributariaAtiva: true });
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '00',
            icmsOrigin: '0',
            icmsRate: 18,
            pisCst: '01',
            pisRate: 1.65,
            cofinsCst: '01',
            cofinsRate: 7.6,
            cstIbsCbs: '000',
            codClassificacao: '000001',
          },
        ]);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado().IBSCBS).toMatchObject({
          CST: '000',
          cClassTrib: '000001',
        });
        const total =
          invoicyApiService.emitNfe.mock.calls.at(-1)[1][0].Documento.total;
        expect(total.IBSCBSTot).toBeDefined();
        expect(total.vNFIBScbsIS).toBeDefined();
      });

      it('calcula e destaca o imposto no Regime Normal', async () => {
        comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '00',
            icmsOrigin: '0',
            icmsRate: 18,
            pisCst: '01',
            pisRate: 1.65,
            cofinsCst: '01',
            cofinsRate: 7.6,
          },
        ]);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado().ICMS).toMatchObject({
          CST: '00',
          vBC: 200,
          pICMS: 18,
          vICMS_icms: 36,
        });
        expect(totaisEnviados().vICMS_ttlnfe).toBe('36.00');
        expect(totaisEnviados().vBC_ttlnfe).toBe('200.00');
      });

      /**
       * Sem alíquota cadastrada a nota sairia com imposto zerado. Barrar é o
       * comportamento correto — é o defeito que o motor existe para eliminar.
       */
      it('barra a emissão do Regime Normal quando falta alíquota', async () => {
        comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '00',
            pisCst: '49',
            cofinsCst: '49',
          },
        ]);

        await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow(
          /Item 1.*alíquota de ICMS/s,
        );
        expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
      });

      /**
       * A regra da UF de destino vence o padrão do produto: é assim que uma
       * empresa que vende para vários estados usa a MVA de cada protocolo.
       */
      it('usa a regra de ST da UF de destino quando existe', async () => {
        comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '10',
            icmsRate: 18,
            icmsStMva: 30,
            pisCst: '49',
            cofinsCst: '49',
          },
        ]);
        prisma.productStRule.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            ufDestino: 'SP',
            mva: 45,
            aliquotaInterna: 18,
          },
        ]);

        await service.emit(mockCompanyId, mockEmitDto);

        expect(impostoEnviado().ICMS).toMatchObject({
          CST: '10',
          pMVAST: 45,
          pICMSST: 18,
        });
        expect(totaisEnviados().vBCST_ttlnfe).not.toBe('0.00');
      });

      it('barra o CST de substituição tributária quando falta MVA', async () => {
        comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: 'product-1',
            icmsCst: '10',
            icmsRate: 18,
            pisCst: '49',
            cofinsCst: '49',
          },
        ]);

        await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow(
          /MVA/,
        );
      });
    });

    it('should throw if items are empty', async () => {
      await expect(
        service.emit(mockCompanyId, { ...mockEmitDto, items: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    /**
     * O transporte não pode reabrir a decisão de ambiente. Quando ele resolvia
     * sozinho, caía no campo global `activeEnvironment` (que a ativação de
     * qualquer docType sobrescreve) e a nota podia ser enviada ao host de um
     * ambiente carregando o `tpAmb` do outro — deixando os eventos dela, que
     * são roteados pelo tpAmb do XML, apontados para o ambiente errado.
     */
    it('transmite no mesmo ambiente com que montou o payload', async () => {
      await service.emit(mockCompanyId, mockEmitDto);

      const [, documentos, invoicyConfigId, forceEnvironment] =
        invoicyApiService.emitNfe.mock.calls[0];

      expect(invoicyConfigId).toBe('config-id');
      expect(forceEnvironment).toBe('HOMOLOGACAO');
      expect(documentos[0].Documento.ide.tpAmb).toBe(2);
    });

    /**
     * A 656 nao fala dos dados da nota: e bloqueio temporario por excesso de
     * tentativas. Sem orientacao, o usuario clica em "Corrigir e reemitir" e
     * renova o bloqueio.
     */
    it('orienta a esperar quando a SEFAZ devolve Consumo Indevido (656)', async () => {
      invoicyApiService.emitNfe.mockResolvedValue([
        {
          Codigo: 100,
          Documentos: [
            {
              Situacao: { SitCodigo: 656, SitDescricao: 'Consumo Indevido' },
            },
          ],
        },
      ]);

      await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow(
        /NAO reenvie agora/,
      );
    });

    it('mantem intacta a mensagem de rejeicao sem orientacao cadastrada', async () => {
      invoicyApiService.emitNfe.mockResolvedValue([
        {
          Codigo: 100,
          Documentos: [
            {
              Situacao: {
                SitCodigo: 999,
                SitDescricao: 'Rejeicao: motivo especifico da SEFAZ',
              },
            },
          ],
        },
      ]);

      await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow(
        'NF-e rejeitada: Rejeicao: motivo especifico da SEFAZ',
      );
    });

    /**
     * A 203 diz que o CNPJ/IE nao esta habilitado na SEFAZ: a providencia e do
     * contador, fora do Atrupe, e o texto cru nao diz isso. A mensagem leva a
     * orientacao, e e ela que tratarFalhaEmissao grava como motivo.
     */
    it('203 (emissor nao habilitado) aponta a providencia na SEFAZ', async () => {
      invoicyApiService.emitNfe.mockResolvedValue([
        {
          Codigo: 100,
          Documentos: [
            {
              Situacao: {
                SitCodigo: 203,
                SitDescricao:
                  'Rejeicao: Emissor nao habilitado para emissao da NF-e',
              },
            },
          ],
        },
      ]);

      await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow(
        /Emissor nao habilitado.*O que fazer \(habilitação na SEFAZ, fora do Atrupe\)/,
      );

      const motivoGravado =
        prisma.nfe.update.mock.calls.at(-1)[0].data.motivoRejeicao;
      expect(motivoGravado).toContain('O que fazer (habilitação na SEFAZ');
      expect(motivoGravado).toContain('contador');
    });

    /**
     * Toda devolucao era rejeitada com a 321 ("nao possui documento fiscal
     * referenciado") mesmo com a chave preenchida na tela: o payload usava
     * `NFref` (grafia da tag XML da SEFAZ) e o provedor so reconhece `NFRef`.
     */
    describe('documento referenciado', () => {
      const CHAVE_REFERENCIADA = '35260212345678000123550010000000011123456789';

      const enviado = () =>
        invoicyApiService.emitNfe.mock.calls[0][1][0].Documento;

      it('envia a chave em NFRef, com a caixa do contrato do provedor', async () => {
        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          tipo: 0,
          finalidade: 4,
          nfeReferenciada: CHAVE_REFERENCIADA,
        });

        expect(enviado().ide.NFRef).toEqual([{ refNFe: CHAVE_REFERENCIADA }]);
        // A grafia antiga era ignorada pelo provedor sem erro nenhum.
        expect(enviado().ide.NFref).toBeUndefined();
      });

      it('limpa a mascara da chave antes de enviar', async () => {
        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          finalidade: 4,
          nfeReferenciada:
            '3526 0212 3456 7800 0123 5500 1000 0000 0111 2345 6789',
        });

        expect(enviado().ide.NFRef).toEqual([{ refNFe: CHAVE_REFERENCIADA }]);
      });

      it('nao envia o grupo quando nao ha nota referenciada', async () => {
        await service.emit(mockCompanyId, mockEmitDto);

        expect(enviado().ide.NFRef).toBeUndefined();
      });
    });

    /**
     * Cada tentativa criava uma linha nova. Na avulsa porque, sem orderId, o
     * fluxo caia direto no create; na nota de ordem porque so DRAFT era
     * reaproveitado, e a tentativa que falha deixa a linha em REJECTED.
     */
    describe('reaproveitamento da linha entre tentativas', () => {
      it('reaproveita a nota rejeitada informada em vez de criar outra', async () => {
        prisma.nfe.findFirst.mockResolvedValue({
          id: 'nfe-rejeitada',
          companyId: mockCompanyId,
          status: NfeStatus.REJECTED,
        });

        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          reissueOfNfeId: 'nfe-rejeitada',
        });

        expect(prisma.nfe.create).not.toHaveBeenCalled();
        expect(prisma.nfe.update).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'nfe-rejeitada' } }),
        );
      });

      it('nao reaproveita linha de outra empresa nem ja autorizada', async () => {
        // O findFirst filtra por companyId e status REJECTED: quando nao casa,
        // a emissao segue e cria a linha normalmente.
        prisma.nfe.findFirst.mockResolvedValue(null);

        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          reissueOfNfeId: 'nota-de-outra-empresa',
        });

        expect(prisma.nfe.create).toHaveBeenCalled();
      });

      it('procura a linha da ordem tambem em REJECTED, nao so em DRAFT', async () => {
        prisma.nfe.findFirst.mockResolvedValue(null);

        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          orderId: mockOrderId,
        });

        expect(prisma.nfe.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              orderId: mockOrderId,
              status: { in: [NfeStatus.DRAFT, NfeStatus.REJECTED] },
            }),
          }),
        );
      });
    });

    /**
     * dhSaiEnt anterior a dhEmi e rejeicao 505. A data de saida vem da tela,
     * montada antes; dhEmi nasce na transmissao. O intervalo entre os dois
     * instantes — mais os segundos que o campo truncava — colocava a saida no
     * passado e o cliente corrigia na mao a cada emissao.
     */
    describe('data de saida', () => {
      const enviado = () =>
        invoicyApiService.emitNfe.mock.calls[0][1][0].Documento;

      it('nunca envia saida anterior a emissao', async () => {
        const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);

        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          dataSaida: ontem.toISOString(),
        });

        const { dhEmi, dhSaiEnt } = enviado().ide;
        expect(new Date(dhSaiEnt).getTime()).toBeGreaterThanOrEqual(
          new Date(dhEmi).getTime(),
        );
      });

      it('preserva data de saida futura, que e intencional', async () => {
        const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          dataSaida: amanha.toISOString(),
        });

        expect(enviado().ide.dhSaiEnt).toBe(amanha.toISOString());
      });
    });

    /**
     * cProd e a coluna "COD. PROD." do DANFE. Saia o id interno (UUID) porque
     * o codigo cadastrado nao era enviado pela tela nem aceito pelo DTO, e era
     * esse UUID que o cliente final via impresso na nota.
     */
    describe('codigo do produto no XML', () => {
      const enviado = () =>
        invoicyApiService.emitNfe.mock.calls[0][1][0].Documento;

      it('usa o codigo cadastrado do produto', async () => {
        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          items: [{ ...mockEmitDto.items[0], productCode: 'ADBLK-001' }],
        });

        expect(enviado().det[0].prod.cProd).toBe('ADBLK-001');
      });

      it('cai no id interno quando o produto nao tem codigo', async () => {
        await service.emit(mockCompanyId, {
          ...mockEmitDto,
          items: [{ ...mockEmitDto.items[0], productCode: undefined }],
        });

        expect(enviado().det[0].prod.cProd).toBe(
          mockEmitDto.items[0].productId,
        );
      });
    });

    /**
     * Cliente migrado trouxe a Inscricao Municipal como "630041430 ". O
     * schema da NF-e proibe espaco nas pontas e a rejeicao vinha como
     * SAXParseException apontando a coluna do XML, sem dizer o campo.
     */
    describe('texto vindo de dado migrado', () => {
      const enviado = () =>
        invoicyApiService.emitNfe.mock.calls[0][1][0].Documento;

      const comEmpresa = (over) =>
        invoicyService.getConfig.mockResolvedValue({
          ...mockConfig,
          company: { ...mockConfig.company, ...over },
        });

      it('tira o espaco do fim da inscricao municipal', async () => {
        comEmpresa({ municipalRegistration: '630041430 ' });

        await service.emit(mockCompanyId, mockEmitDto);

        expect(enviado().emit.IM).toBe('630041430');
      });

      it('omite a inscricao municipal quando ela e so espaco', async () => {
        comEmpresa({ municipalRegistration: '   ' });

        await service.emit(mockCompanyId, mockEmitDto);

        expect(enviado().emit.IM).toBeUndefined();
      });

      it('tira o espaco das pontas da razao social', async () => {
        comEmpresa({ legalName: '  SPARTA CVL LTDA  ' });

        await service.emit(mockCompanyId, mockEmitDto);

        expect(enviado().emit.xNome).toBe('SPARTA CVL LTDA');
      });
    });

    it('should handle Invoicy failure', async () => {
      invoicyApiService.emitNfe.mockResolvedValue([
        { Codigo: 225, Descricao: 'Rejeitado pela SEFAZ' },
      ]);

      await expect(service.emit(mockCompanyId, mockEmitDto)).rejects.toThrow();
    });

    /**
     * A reserva acontece antes da transmissão, então toda rejeição queima um
     * número. Como a nota rejeitada nunca existiu na SEFAZ, o número continua
     * livre — e devolvê-lo evita um vão que só se regulariza com inutilização.
     */
    describe('devolução do número após rejeição', () => {
      const rejeitadaPelaSefaz = () =>
        invoicyApiService.emitNfe.mockResolvedValue([
          {
            Codigo: 100,
            Documentos: [
              {
                Situacao: {
                  SitCodigo: 539,
                  SitDescricao: 'Duplicidade de NF-e',
                },
              },
            ],
          },
        ]);

      const updatesDeSequencia = () =>
        prisma.$executeRaw.mock.calls
          .map((call: any) => call[0].join(''))
          .filter((sql: string) => sql.includes('nfeNextNumber'));

      it('devolve o número quando a SEFAZ recusa a nota', async () => {
        rejeitadaPelaSefaz();

        await expect(
          service.emit(mockCompanyId, mockEmitDto),
        ).rejects.toThrow();

        expect(updatesDeSequencia()).toHaveLength(1);
      });

      it('não devolve o número em falha de transporte', async () => {
        // A nota PODE ter sido autorizada sem a resposta chegar. Devolver aqui
        // levaria a duplicidade 539 na emissão seguinte.
        invoicyApiService.emitNfe.mockRejectedValue(
          new Error('timeout of 45000ms exceeded'),
        );

        await expect(
          service.emit(mockCompanyId, mockEmitDto),
        ).rejects.toThrow();

        expect(updatesDeSequencia()).toHaveLength(0);
      });

      it('não devolve o número quando a nota é autorizada', async () => {
        await service.emit(mockCompanyId, mockEmitDto);

        expect(updatesDeSequencia()).toHaveLength(0);
      });
    });

    // Fase 6: OperationNature passa a alimentar CFOP, finalidade e presença do
    // consumidor. É opt-in por DADO — sem natureza cadastrada, o comportamento
    // anterior tem de permanecer idêntico.
    describe('natureza de operação cadastrada', () => {
      const semCfopDoItem = {
        ...mockEmitDto,
        items: [{ ...mockEmitDto.items[0], cfop: undefined }],
      };

      const enviado = () =>
        invoicyApiService.emitNfe.mock.calls[0][1][0].Documento;

      it('usa o CFOP interno da natureza quando a operação é interna', async () => {
        prisma.operationNature.findFirst.mockResolvedValue({
          id: 'nature-1',
          description: 'Venda de mercadoria',
          finality: '1',
          consumerPresence: '1',
          cfopInternal: { code: '5101' },
          cfopExternal: { code: '6101' },
        });

        await service.emit(mockCompanyId, semCfopDoItem);

        expect(enviado().det[0].prod.CFOP).toBe(5101);
      });

      it('CFOP do item vence o da natureza', async () => {
        prisma.operationNature.findFirst.mockResolvedValue({
          id: 'nature-1',
          description: 'Venda de mercadoria',
          finality: '1',
          consumerPresence: '1',
          cfopInternal: { code: '5101' },
          cfopExternal: { code: '6101' },
        });

        // mockEmitDto traz cfop 5102 explícito no item.
        await service.emit(mockCompanyId, mockEmitDto);

        expect(enviado().det[0].prod.CFOP).toBe(5102);
      });

      it('herda finalidade e presença do consumidor da natureza', async () => {
        prisma.operationNature.findFirst.mockResolvedValue({
          id: 'nature-1',
          description: 'Venda de mercadoria',
          finality: '1',
          consumerPresence: '4',
          cfopInternal: { code: '5102' },
          cfopExternal: { code: '6102' },
        });

        await service.emit(mockCompanyId, semCfopDoItem);

        expect(enviado().ide.indPres).toBe(4);
      });

      it('a emissão sobrescreve a natureza quando informa o valor', async () => {
        prisma.operationNature.findFirst.mockResolvedValue({
          id: 'nature-1',
          description: 'Venda de mercadoria',
          finality: '1',
          consumerPresence: '4',
          cfopInternal: { code: '5102' },
          cfopExternal: { code: '6102' },
        });

        await service.emit(mockCompanyId, {
          ...semCfopDoItem,
          presencaConsumidor: 9,
        });

        expect(enviado().ide.indPres).toBe(9);
      });

      it('sem natureza cadastrada, mantém o comportamento anterior', async () => {
        prisma.operationNature.findFirst.mockResolvedValue(null);

        await service.emit(mockCompanyId, semCfopDoItem);

        // Cai no defaultCfop do emissor e nos defaults históricos.
        expect(enviado().det[0].prod.CFOP).toBe(5102);
        expect(enviado().ide.indPres).toBe(1);
        expect(enviado().ide.finNFe).toBe(1);
      });

      it('ignora finalidade não-numérica em vez de gerar NaN', async () => {
        prisma.operationNature.findFirst.mockResolvedValue({
          id: 'nature-1',
          description: 'Venda de mercadoria',
          finality: 'Normal',
          consumerPresence: '',
          cfopInternal: { code: '5102' },
          cfopExternal: { code: '6102' },
        });

        await service.emit(mockCompanyId, semCfopDoItem);

        expect(enviado().ide.finNFe).toBe(1);
        expect(enviado().ide.indPres).toBe(1);
      });
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

    /**
     * O prazo corre da AUTORIZAÇÃO e quem o valida é a SEFAZ da UF. A regra
     * antiga barrava tudo em 24 horas contadas da emissão, e impedia o
     * cancelamento extemporâneo que vários estados aceitam — São Paulo recebe
     * o evento até 480 horas.
     */
    describe('prazo de cancelamento', () => {
      const JUSTIFICATIVA = 'Cancelamento por erro de digitação no documento';
      const horasAtras = (horas: number) =>
        new Date(Date.now() - horas * 60 * 60 * 1000);

      const comDatas = (
        dados: Partial<{ dataEmissao: Date; dataAutorizacao: Date }>,
        prazoConfigurado?: number | null,
      ) => {
        prisma.nfe.findFirst.mockResolvedValue({
          ...authorizedNfe,
          invoicyConfigId: 'config-id',
          ...dados,
        });
        prisma.invoicyConfig.findFirst.mockResolvedValue(
          prazoConfigurado === undefined
            ? null
            : { prazoCancelamentoNfeHoras: prazoConfigurado },
        );
      };

      it('deixa cancelar depois de 48 horas, sem limite configurado', async () => {
        comDatas({
          dataEmissao: horasAtras(50),
          dataAutorizacao: horasAtras(48),
        });

        const result: any = await service.cancel(mockNfeId, mockCompanyId, {
          justificativa: JUSTIFICATIVA,
        });

        expect(invoicyApiService.cancelNfe).toHaveBeenCalled();
        // O usuário precisa saber que está fora do prazo regular.
        expect(result.avisoPrazo).toMatch(/extempor/i);
      });

      it('conta da autorização, não da emissão', async () => {
        comDatas({
          dataEmissao: horasAtras(300),
          dataAutorizacao: horasAtras(2),
        });

        const result: any = await service.cancel(mockNfeId, mockCompanyId, {
          justificativa: JUSTIFICATIVA,
        });

        // Dentro das 24h da autorização: cancelamento comum, sem aviso.
        expect(result.avisoPrazo).toBeUndefined();
      });

      it('respeita o limite configurado no emissor', async () => {
        comDatas(
          { dataEmissao: horasAtras(100), dataAutorizacao: horasAtras(100) },
          48,
        );

        await expect(
          service.cancel(mockNfeId, mockCompanyId, {
            justificativa: JUSTIFICATIVA,
          }),
        ).rejects.toThrow(/pedido formal à SEFAZ/);

        expect(invoicyApiService.cancelNfe).not.toHaveBeenCalled();
      });

      it('explica a rejeição 501 em vez de repetir o texto da SEFAZ', async () => {
        comDatas({
          dataEmissao: horasAtras(30),
          dataAutorizacao: horasAtras(30),
        });
        invoicyApiService.cancelNfe.mockResolvedValue([
          {
            Codigo: 100,
            Descricao: 'ok',
            Documentos: [
              {
                Situacao: {
                  SitCodigo: 501,
                  SitDescricao:
                    'Rejeicao: Prazo de cancelamento superior ao previsto na Legislacao',
                },
              },
            ],
          },
        ]);

        await expect(
          service.cancel(mockNfeId, mockCompanyId, {
            justificativa: JUSTIFICATIVA,
          }),
        ).rejects.toThrow(/posto fiscal/);
      });
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

  describe('getCorrectionEventPdf', () => {
    const eventId = 'evt-1';
    const pdf = Buffer.from('%PDF-dacce');

    const registeredEvent = (overrides = {}) => ({
      id: eventId,
      sequenciaEvento: 2,
      status: 'REGISTERED',
      ambiente: 2,
      document: null,
      ...overrides,
    });

    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue({
        id: mockNfeId,
        chaveAcesso: '42260657968205000182550010000000101000005700',
        ambiente: 2,
      });
    });

    it('devolve o PDF do cache sem chamar o provedor', async () => {
      prisma.nfeCorrectionEvent.findFirst.mockResolvedValue(
        registeredEvent({ document: { pdf } }),
      );

      const result = await service.getCorrectionEventPdf(
        mockNfeId,
        eventId,
        mockCompanyId,
      );

      expect(result.pdfBase64).toBe(pdf.toString('base64'));
      expect(result.sequencia).toBe(2);
      expect(
        mockInvoicyApiService.consultDocumentEvents,
      ).not.toHaveBeenCalled();
    });

    it('busca no provedor o evento com a sequencia certa e cacheia', async () => {
      prisma.nfeCorrectionEvent.findFirst.mockResolvedValue(registeredEvent());
      mockInvoicyApiService.consultDocumentEvents.mockResolvedValue([
        {
          Documentos: [
            {
              Eventos: [
                {
                  DocEvenSeq: '1',
                  DocEvePDF: Buffer.from('%PDF-outra').toString('base64'),
                },
                { DocEvenSeq: '2', DocEvePDF: pdf.toString('base64') },
              ],
            },
          ],
        },
      ]);

      const result = await service.getCorrectionEventPdf(
        mockNfeId,
        eventId,
        mockCompanyId,
      );

      expect(result.pdfBase64).toBe(pdf.toString('base64'));
      expect(prisma.nfeCorrectionDocument.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { correctionEventId: eventId },
          create: { correctionEventId: eventId, pdf },
        }),
      );
    });

    it('recusa base64 que nao seja PDF de verdade', async () => {
      prisma.nfeCorrectionEvent.findFirst.mockResolvedValue(registeredEvent());
      mockInvoicyApiService.consultDocumentEvents.mockResolvedValue([
        {
          Documentos: [
            {
              Eventos: [
                {
                  DocEvenSeq: '2',
                  DocEvePDF:
                    Buffer.from('<html>erro</html>').toString('base64'),
                },
              ],
            },
          ],
        },
      ]);

      await expect(
        service.getCorrectionEventPdf(mockNfeId, eventId, mockCompanyId),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.nfeCorrectionDocument.upsert).not.toHaveBeenCalled();
    });

    it('nao busca DACCE de evento rejeitado', async () => {
      prisma.nfeCorrectionEvent.findFirst.mockResolvedValue(
        registeredEvent({ status: 'REJECTED' }),
      );

      await expect(
        service.getCorrectionEventPdf(mockNfeId, eventId, mockCompanyId),
      ).rejects.toThrow('registradas na SEFAZ');

      expect(
        mockInvoicyApiService.consultDocumentEvents,
      ).not.toHaveBeenCalled();
    });

    it('devolve 503 quando a consulta ao provedor falha', async () => {
      prisma.nfeCorrectionEvent.findFirst.mockResolvedValue(registeredEvent());
      mockInvoicyApiService.consultDocumentEvents.mockRejectedValue(
        new Error('timeout'),
      );

      await expect(
        service.getCorrectionEventPdf(mockNfeId, eventId, mockCompanyId),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  /**
   * O XML so' era gravado na resposta sincrona da emissao. Nota autorizada
   * depois por consulta, ou emissao respondida sem base64, ficava AUTHORIZED
   * sem XML e sumia da exportacao ("Nenhuma NF-e com XML encontrada") — o
   * relato do cliente em 04/09/2026.
   */
  describe('XML autorizado: exportacao, consulta de status e download', () => {
    const xmlAutorizado =
      '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe></NFe></nfeProc>';
    const xmlBase64 = Buffer.from(xmlAutorizado).toString('base64');
    const chave1 = '35260912345678000123550010000000721000000723';
    const chave2 = '35260912345678000123550010000000731000000734';
    const emitidaEm = new Date('2026-09-02T19:13:15.837Z');

    const notaComXml = {
      id: 'nfe-1',
      numero: 72,
      serie: 1,
      chaveAcesso: chave1,
      ambiente: 1,
      invoicyConfigId: 'cfg-1',
      xmlAutorizado,
      dataEmissao: emitidaEm,
      dataAutorizacao: emitidaEm,
      correctionEvents: [],
    };
    const notaSemXml = {
      ...notaComXml,
      id: 'nfe-2',
      numero: 73,
      chaveAcesso: chave2,
      xmlAutorizado: null,
    };

    const respostaComXml = [
      {
        Codigo: 100,
        Descricao: 'ok',
        Documentos: [
          { DocXMLBase64: xmlBase64, DocDhAut: '2026-09-02T16:13:15-03:00' },
        ],
      },
    ];
    const respostaSemXml = [{ Codigo: 100, Descricao: 'ok', Documentos: [{}] }];

    const entradasDoZip = async (zip: Buffer): Promise<string[]> => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const JSZip = require('jszip');
      const conteudo = await JSZip.loadAsync(zip);
      return Object.keys(conteudo.files).sort();
    };

    beforeEach(() => {
      prisma.nfe.update.mockResolvedValue({});
      invoicyApiService.consultDocumentXml.mockResolvedValue(respostaSemXml);
      invoicyApiService.consultNfeSefaz.mockResolvedValue(respostaSemXml);
    });

    describe('exportXml', () => {
      it('rejeita periodo fora do formato AAAA-MM-DD', async () => {
        await expect(
          service.exportXml(mockCompanyId, '01/09/2026', '2026-09-30'),
        ).rejects.toThrow(BadRequestException);
      });

      it('le o periodo no fuso da operacao, nao em UTC', async () => {
        prisma.nfe.findMany.mockResolvedValue([notaComXml]);

        await service.exportXml(mockCompanyId, '2026-09-01', '2026-09-30');

        const where = prisma.nfe.findMany.mock.calls[0][0].where;
        const periodo = where.OR[0].dataEmissao;
        expect(periodo.gte.toISOString()).toBe('2026-09-01T03:00:00.000Z');
        expect(periodo.lte.toISOString()).toBe('2026-10-01T02:59:59.999Z');
      });

      it('sem nota autorizada no periodo: 404 diz o periodo, nao "sem XML"', async () => {
        prisma.nfe.findMany.mockResolvedValue([]);

        await expect(
          service.exportXml(mockCompanyId, '2026-09-01', '2026-09-30'),
        ).rejects.toThrow(
          /Nenhuma NF-e autorizada entre 01\/09\/2026 e 30\/09\/2026/,
        );
      });

      it('nota autorizada sem XML: rebusca no provedor, grava e inclui no ZIP', async () => {
        prisma.nfe.findMany.mockResolvedValue([notaComXml, notaSemXml]);
        invoicyApiService.consultDocumentXml.mockResolvedValue(respostaComXml);

        const { zip, total, faltantes } = await service.exportXml(
          mockCompanyId,
          '2026-09-01',
          '2026-09-30',
        );

        expect(total).toBe(2);
        expect(faltantes).toEqual([]);
        expect(await entradasDoZip(zip)).toEqual([
          `NFe_72_${chave1}.xml`,
          `NFe_73_${chave2}.xml`,
        ]);
        expect(prisma.nfe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'nfe-2' },
            data: expect.objectContaining({ xmlAutorizado }),
          }),
        );
      });

      it('provedor devolve so o link: baixa o XML pelo link', async () => {
        prisma.nfe.findMany.mockResolvedValue([notaSemXml]);
        invoicyApiService.consultDocumentXml.mockResolvedValue([
          {
            Codigo: 100,
            Descricao: 'ok',
            Documentos: [
              { DocXMLBase64: '', DocXMLDownload: 'https://invoicy.test/xml' },
            ],
          },
        ]);
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          text: async () => xmlAutorizado,
        } as any);

        try {
          const { faltantes } = await service.exportXml(
            mockCompanyId,
            '2026-09-01',
            '2026-09-30',
          );

          expect(fetchSpy).toHaveBeenCalledWith(
            'https://invoicy.test/xml',
            expect.anything(),
          );
          expect(faltantes).toEqual([]);
        } finally {
          fetchSpy.mockRestore();
        }
      });

      it('nenhum XML obtido: 404 com a contagem e as notas', async () => {
        prisma.nfe.findMany.mockResolvedValue([notaSemXml]);
        invoicyApiService.consultDocumentXml.mockRejectedValue(
          new Error('timeout'),
        );

        await expect(
          service.exportXml(mockCompanyId, '2026-09-01', '2026-09-30'),
        ).rejects.toThrow(
          /1 NF-e autorizada\(s\) no período, mas nenhum XML .* \(notas 73\/1\)/,
        );
      });

      it('ZIP parcial lista as faltantes em FALTANTES.txt', async () => {
        prisma.nfe.findMany.mockResolvedValue([notaComXml, notaSemXml]);

        const { zip, faltantes } = await service.exportXml(
          mockCompanyId,
          '2026-09-01',
          '2026-09-30',
        );

        expect(faltantes).toEqual([
          { numero: 73, serie: 1, chaveAcesso: chave2 },
        ]);
        expect(await entradasDoZip(zip)).toEqual([
          'FALTANTES.txt',
          `NFe_72_${chave1}.xml`,
        ]);
      });
    });

    describe('consultStatus — autorizacao por consulta grava XML e datas', () => {
      const notaRejeitadaPorTransporte = {
        id: mockNfeId,
        numero: 5,
        serie: 1,
        status: 'REJECTED',
        chaveAcesso: chave1,
        ambiente: 2,
        invoicyConfigId: 'cfg-1',
        xmlAutorizado: null,
        dataEmissao: null,
        dataAutorizacao: null,
        protocolo: null,
        danfeUrl: null,
        invoicyId: null,
      };

      it('nota rejeitada por falha de transporte que a SEFAZ autorizou: grava XML, datas e protocolo', async () => {
        prisma.nfe.findFirst.mockResolvedValue(notaRejeitadaPorTransporte);
        invoicyApiService.consultNfeSefaz.mockResolvedValue([
          {
            Codigo: 100,
            Descricao: 'ok',
            Documentos: [
              {
                Situacao: {
                  SitCodigo: 100,
                  SitDescricao: 'Autorizado o uso da NF-e',
                },
                DocProtocolo: '135260000000001',
                DocDhAut: '2026-09-02T16:13:15-03:00',
                DocXMLBase64: xmlBase64,
                DocPDFDownload: 'https://invoicy.test/danfe.pdf',
                DocIDUnico: 'doc-1',
              },
            ],
          },
        ]);

        const resultado = await service.consultStatus(mockNfeId, mockCompanyId);

        expect(resultado.status).toBe('AUTHORIZED');
        expect(resultado.statusChanged).toBe(true);
        expect(resultado.xmlDisponivel).toBe(true);

        const data = prisma.nfe.update.mock.calls[0][0].data;
        expect(data).toEqual(
          expect.objectContaining({
            status: 'AUTHORIZED',
            xmlAutorizado,
            protocolo: '135260000000001',
            danfeUrl: 'https://invoicy.test/danfe.pdf',
            invoicyId: 'doc-1',
          }),
        );
        expect(data.dataAutorizacao.toISOString()).toBe(
          '2026-09-02T19:13:15.000Z',
        );
        expect(data.dataEmissao.toISOString()).toBe('2026-09-02T19:13:15.000Z');
        // O XML veio na propria consulta: nao gasta outra chamada.
        expect(invoicyApiService.consultDocumentXml).not.toHaveBeenCalled();
      });

      it('nota ja autorizada sem XML: a consulta recupera o XML mesmo sem mudanca de status', async () => {
        prisma.nfe.findFirst.mockResolvedValue({
          ...notaRejeitadaPorTransporte,
          status: 'AUTHORIZED',
          dataEmissao: emitidaEm,
          dataAutorizacao: emitidaEm,
        });
        invoicyApiService.consultNfeSefaz.mockResolvedValue([
          {
            Codigo: 100,
            Descricao: 'ok',
            Documentos: [{ Situacao: { SitCodigo: 100 } }],
          },
        ]);
        invoicyApiService.consultDocumentXml.mockResolvedValue(respostaComXml);

        const resultado = await service.consultStatus(mockNfeId, mockCompanyId);

        expect(resultado.statusChanged).toBe(false);
        expect(resultado.xmlDisponivel).toBe(true);
        expect(prisma.nfe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: mockNfeId },
            data: expect.objectContaining({ xmlAutorizado }),
          }),
        );
      });

      it('nao sobrescreve XML, datas nem protocolo ja gravados ao registrar CC-e', async () => {
        prisma.nfe.findFirst.mockResolvedValue({
          ...notaRejeitadaPorTransporte,
          status: 'AUTHORIZED',
          xmlAutorizado,
          dataEmissao: emitidaEm,
          dataAutorizacao: emitidaEm,
          protocolo: 'P0',
        });
        invoicyApiService.consultNfeSefaz.mockResolvedValue([
          {
            Codigo: 100,
            Descricao: 'ok',
            Documentos: [
              {
                Situacao: { SitCodigo: 135 },
                DocEveTp: 110110,
                DocXMLBase64: Buffer.from('<nfeProc>outro</nfeProc>').toString(
                  'base64',
                ),
                DocProtocolo: 'P9',
              },
            ],
          },
        ]);

        const resultado = await service.consultStatus(mockNfeId, mockCompanyId);

        expect(resultado.status).toBe('CORRECTION_SENT');
        expect(prisma.nfe.update.mock.calls[0][0].data).toEqual({
          status: 'CORRECTION_SENT',
        });
      });
    });

    describe('getXml', () => {
      it('sem XML gravado, rebusca no provedor antes de negar', async () => {
        prisma.nfe.findFirst.mockResolvedValue({
          ...notaSemXml,
          id: mockNfeId,
        });
        invoicyApiService.consultDocumentXml.mockResolvedValue(respostaComXml);

        await expect(service.getXml(mockNfeId, mockCompanyId)).resolves.toEqual(
          { xml: xmlAutorizado },
        );
        expect(prisma.nfe.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ xmlAutorizado }),
          }),
        );
      });

      it('404 quando nem o provedor tem o XML', async () => {
        prisma.nfe.findFirst.mockResolvedValue({
          ...notaSemXml,
          id: mockNfeId,
        });

        await expect(service.getXml(mockNfeId, mockCompanyId)).rejects.toThrow(
          NotFoundException,
        );
        expect(invoicyApiService.consultDocumentXml).toHaveBeenCalled();
        expect(invoicyApiService.consultNfeSefaz).toHaveBeenCalled();
      });
    });
  });
});

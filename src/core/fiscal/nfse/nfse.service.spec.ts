import { Test, TestingModule } from '@nestjs/testing';
import { NfseService } from './nfse.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { MailService } from '../../mail/mail.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { NfseStatus, OrderStatus } from '@prisma/client';

// Mock fetchCepData para evitar chamadas HTTP reais
jest.mock('../utils/cep.util', () => ({
  fetchCepData: jest.fn().mockResolvedValue({
    cep: '01310100',
    logradouro: 'Avenida Paulista',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
    codigoIbge: '3550308',
  }),
}));

const mockCompanyId = 'company-uuid-123';
const mockOrderId = 'order-uuid-456';
const mockNfseId = 'nfse-uuid-789';

const mockOrder = {
  id: mockOrderId,
  companyId: mockCompanyId,
  quotationId: 'quotation-1',
  status: 'COMPLETED',
  nfes: [],
  nfeOrders: [],
  nfses: [],
  nfces: [],
  items: [
    {
      id: 'item-1',
      product: {
        id: 'service-1',
        name: 'Consultoria',
        isService: true,
        fiscalData: {
          codigoServico: '1.05',
          aliquotaIss: 5,
          discriminacao: 'Serviço de consultoria em TI',
        },
      },
      quantity: 1,
      unitValue: 500,
    },
  ],
  client: {
    id: 'client-1',
    name: 'Cliente Teste',
    document: '12345678901234',
    corporateName: 'Cliente Teste LTDA',
    cnpj: '12345678901234',
    email: 'cliente@teste.com',
    address: [
      {
        street: 'Avenida Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        zipcode: '01310100',
      },
    ],
  },
  company: {
    id: mockCompanyId,
    name: 'Empresa Teste LTDA',
    document: '12345678000123',
  },
};

const mockNfse = {
  id: mockNfseId,
  companyId: mockCompanyId,
  orderId: mockOrderId,
  numero: 1,
  serie: 'A1',
  rpsNumero: 1,
  rpsSerie: 'A1',
  status: NfseStatus.PENDING,
  ambiente: 2,
  valorServicos: 500,
};

const mockInvoicyResponse = [
  {
    Codigo: 100,
    Descricao: 'Documentos processados com sucesso',
    Documentos: [
      {
        DocProtocolo: '123456789',
        DocIDUnico: 'unique-id-123',
        DocPDFDownload: 'https://invoicy.com/pdf/123',
        DocXMLBase64: 'base64xml',
        NFSe: {
          NFSeNumero: 1,
          NFSeCodVerificacao: 'ABC123',
        },
        Situacao: {
          SitCodigo: 100,
          SitDescricao: 'NFS-e autorizada',
        },
      },
    ],
  },
];

const mockPrismaService = {
  order: { findUnique: jest.fn(), findFirst: jest.fn() },
  company: { findUnique: jest.fn() },
  quotation: { findFirst: jest.fn() },
  nfse: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  invoicyConfig: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn((callback) => callback(mockPrismaService)),
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  getConfig: jest.fn(),
  incrementRpsNumber: jest.fn(),
  incrementNfseRpsNumber: jest.fn().mockResolvedValue(1),
};

const mockFiscalCredentialResolver = {
  resolveEnvironmentFromConfig: jest.fn().mockReturnValue('HOMOLOGACAO'),
  assertEnvironmentReady: jest.fn().mockResolvedValue(undefined),
  reserveNfseRpsNumber: jest
    .fn()
    .mockResolvedValue({ reservedNumber: 1, series: 'A1' }),
};

const mockInvoicyApiService = {
  emitNfse: jest.fn(),
  cancelNfse: jest.fn(),
  getStatusNfse: jest.fn(),
  consultNfse: jest.fn(),
};

describe('NfseService', () => {
  let service: NfseService;
  let prisma: typeof mockPrismaService;
  let invoicyApiService: typeof mockInvoicyApiService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrismaService.$transaction.mockImplementation((callback) =>
      callback(mockPrismaService),
    );
    mockPrismaService.$queryRaw.mockResolvedValue([
      { id: 'config-1', proximoRpsNfse: 1, serieNfse: 'A1' },
    ]);
    mockPrismaService.$executeRaw.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfseService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyApiService, useValue: mockInvoicyApiService },
        {
          provide: FiscalCredentialResolverService,
          useValue: mockFiscalCredentialResolver,
        },
        {
          provide: MailService,
          useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<NfseService>(NfseService);
    prisma = module.get(PrismaService);
    invoicyApiService = module.get(InvoicyApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated list of NFSes', async () => {
      prisma.nfse.findMany.mockResolvedValue([mockNfse]);
      prisma.nfse.count.mockResolvedValue(1);

      const result = await service.findAll(mockCompanyId, {});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('should return NFSe when found', async () => {
      prisma.nfse.findFirst.mockResolvedValue(mockNfse);

      const result = await service.findById(mockNfseId, mockCompanyId);

      expect(result.id).toBe(mockNfseId);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.nfse.findFirst.mockResolvedValue(null);

      await expect(service.findById('invalid', mockCompanyId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('emitFromOrder', () => {
    beforeEach(() => {
      // Mock quotation para emitFromOrder
      prisma.quotation.findFirst.mockResolvedValue({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: mockOrder,
        client: mockOrder.client,
        quotationProduct: [
          {
            id: 'qp-1',
            productId: 'service-1',
            quantity: 1,
            finalValue: 500,
            totalValue: 500,
            product: mockOrder.items[0].product,
          },
        ],
      });
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.findFirst.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockOrder.company);
      mockInvoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        serieNfse: 'A1',
        proximoRpsNfse: 1,
        activeNumbering: {
          nfe: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfce: { environment: 'HOMOLOGACAO', series: 1, nextNumber: 1 },
          nfse: { environment: 'HOMOLOGACAO', series: 'A1', nextNumber: 1 },
        },
        ambiente: 2,
        isActive: true,
        ibgeCode: '4314902',
        aliquotaIss: 5,
        codigoServico: '1.05',
        emitCrt: 1,
        company: {
          cnpj: '12345678000123',
          legalName: 'Empresa Teste LTDA',
          name: 'Empresa Teste',
          municipalRegistration: '12345',
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
      mockInvoicyService.getDefaultConfig.mockResolvedValue({
        serieNfse: 'A1',
        proximoRpsNfse: 1,
        ambiente: 2,
      });
      invoicyApiService.emitNfse.mockResolvedValue(mockInvoicyResponse);
      prisma.nfse.create.mockResolvedValue(mockNfse);
      prisma.nfse.update.mockResolvedValue({
        ...mockNfse,
        status: NfseStatus.AUTHORIZED,
      });
    });

    it('should emit NFSe from order', async () => {
      const result = await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      expect(result).toBeDefined();
      expect(invoicyApiService.emitNfse).toHaveBeenCalled();
    });

    it('should retry without provider municipal registration when city rejects IM', async () => {
      mockInvoicyApiService.emitNfse
        .mockImplementationOnce(async (_companyId, payloads) => {
          expect(payloads[0].Documento.RPS[0].Prestador.IM).toBe('12345');
          return [
            {
              Codigo: 100,
              Descricao: 'Documentos processados com sucesso',
              Documentos: [
                {
                  Situacao: {
                    SitCodigo: 2,
                    SitDescricao:
                      'Pendente - [#inv0405] - Mensagem retornada pela prefeitura: Código: E0120, Mensagem: IM do prestador nao deve ser informado',
                  },
                },
              ],
            },
          ];
        })
        .mockImplementationOnce(async (_companyId, payloads) => {
          expect(payloads[0].Documento.RPS[0].Prestador.IM).toBeUndefined();
          return mockInvoicyResponse;
        });

      const result = await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      expect(result).toBeDefined();
      expect(invoicyApiService.emitNfse).toHaveBeenCalledTimes(2);
    });

    it('should only include service items', async () => {
      const orderWithProducts = {
        ...mockOrder,
        items: [
          ...mockOrder.items,
          { product: { isService: false }, quantity: 1, unitValue: 100 },
        ],
      };
      prisma.order.findUnique.mockResolvedValue(orderWithProducts);

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      // Verify emitNfse was called with InvoicyNfseRequest structure,
      // repassando emissor e ambiente resolvidos para o transporte.
      expect(invoicyApiService.emitNfse).toHaveBeenCalledWith(
        mockCompanyId,
        expect.arrayContaining([
          expect.objectContaining({
            Documento: expect.objectContaining({
              ModeloDocumento: 'NFSE',
              RPS: expect.any(Array),
            }),
          }),
        ]),
        'config-1',
        'HOMOLOGACAO',
      );
    });

    it('arredonda valores monetários antes de enviar ao Invoicy', async () => {
      // (0.01 * 2.53) / 100 === 0.00025299999999999997 em ponto flutuante.
      // O Invoicy responde HTTP 500 a decimais com 20 dígitos significativos.
      await service.emit(mockCompanyId, {
        tomador: {
          cnpj: '12345678901234',
          razaoSocial: 'Cliente Teste LTDA',
          endereco: 'Avenida Paulista',
          numero: '1000',
          bairro: 'Bela Vista',
          cep: '01310100',
          codigoMunicipio: '3550308',
        },
        codigoServico: '1.05',
        codigoMunicipio: '4314902',
        discriminacao: 'teste',
        valorServicos: 0.01,
        aliquotaIss: 2.53,
        naturezaOperacao: 1,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      const casasDecimais = (n: number) =>
        (String(n).split('.')[1] || '').length;

      expect(casasDecimais(rps.Servico.Valores.ValISS)).toBeLessThanOrEqual(2);
      expect(casasDecimais(rps.ListaItens[0].ItemvIss)).toBeLessThanOrEqual(2);
      expect(JSON.stringify(rps.Servico.Valores.ValISS)).not.toContain(
        '0000000',
      );
    });

    it('should throw if order not found', async () => {
      prisma.quotation.findFirst.mockResolvedValue(null);

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: 'invalid',
          codigoServico: '1.05',
          discriminacao: 'Teste',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject emission for canceled order', async () => {
      prisma.quotation.findFirst.mockResolvedValueOnce({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: { ...mockOrder, status: OrderStatus.CANCELED },
        client: mockOrder.client,
        quotationProduct: [
          {
            id: 'qp-1',
            productId: 'service-1',
            quantity: 1,
            finalValue: 500,
            totalValue: 500,
            product: mockOrder.items[0].product,
          },
        ],
      });

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Teste',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(invoicyApiService.emitNfse).not.toHaveBeenCalled();
    });

    it('should reject emission when order already has active fiscal document', async () => {
      prisma.quotation.findFirst.mockResolvedValueOnce({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: {
          ...mockOrder,
          nfses: [{ id: 'nfse-existing', status: NfseStatus.AUTHORIZED }],
        },
        client: mockOrder.client,
        quotationProduct: [
          {
            id: 'qp-1',
            productId: 'service-1',
            quantity: 1,
            finalValue: 500,
            totalValue: 500,
            product: mockOrder.items[0].product,
          },
        ],
      });

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Teste',
        }),
      ).rejects.toThrow(ConflictException);

      expect(invoicyApiService.emitNfse).not.toHaveBeenCalled();
    });

    it('should reserve RPS number inside transaction before calling Invoicy', async () => {
      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'ServiÃ§o de consultoria em TI',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      // A reserva atômica vive no resolver e é escopada por ambiente.
      expect(
        mockFiscalCredentialResolver.reserveNfseRpsNumber,
      ).toHaveBeenCalledWith(expect.anything(), 'config-1', 'HOMOLOGACAO');
      expect(mockInvoicyService.incrementNfseRpsNumber).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const authorizedNfse = {
      ...mockNfse,
      status: NfseStatus.AUTHORIZED,
      codigoVerificacao: 'ABC123',
    };

    beforeEach(() => {
      prisma.nfse.findFirst.mockResolvedValue(authorizedNfse);
      mockInvoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        serieNfse: 'A1',
        ambiente: 2,
        isActive: true,
      });
      invoicyApiService.cancelNfse.mockResolvedValue([
        {
          Codigo: 100,
          Descricao: 'Documentos processados com sucesso',
          Documentos: [
            {
              DocProtocolo: '123456789',
              Situacao: {
                SitCodigo: 101,
                SitDescricao: 'Cancelamento homologado',
              },
            },
          ],
        },
      ]);
      prisma.nfse.update.mockResolvedValue({
        ...authorizedNfse,
        status: NfseStatus.CANCELLED,
      });
    });

    it('should cancel authorized NFSe', async () => {
      const result = await service.cancel(mockNfseId, mockCompanyId, {
        justificativa: 'Cancelamento por erro de digitação',
      });

      expect(result.status).toBe(NfseStatus.CANCELLED);
    });

    it('should throw if NFSe not authorized', async () => {
      prisma.nfse.findFirst.mockResolvedValue(mockNfse); // PENDING

      await expect(
        service.cancel(mockNfseId, mockCompanyId, {
          justificativa: 'Teste cancelamento',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('consultStatus', () => {
    beforeEach(() => {
      mockInvoicyService.getConfig.mockResolvedValue({
        id: 'config-1',
        ambiente: 2,
      });
    });

    it('reconcilia nota autorizada no provedor que estava REJECTED local', async () => {
      // Caso real: a prefeitura autorizou a nota, mas o sistema gravou a
      // rejeição de uma tentativa anterior do mesmo RPS.
      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        status: NfseStatus.REJECTED,
        numero: 0,
        rpsNumero: 26,
        rpsSerie: '1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockResolvedValue([
        {
          Codigo: 100,
          Documentos: [
            {
              Situacao: { SitCodigo: 100, SitDescricao: 'NFS-e autorizada' },
              NFSe: { NFSeNumero: 1, NFSeCodVerificacao: 'ABC123' },
              DocPDFDownload: 'https://invoicy.com/pdf/1',
            },
          ],
        },
      ]);
      prisma.nfse.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockNfse, ...data }),
      );

      const result = await service.consultStatus(mockNfseId, mockCompanyId);

      expect(result.encontradoNoProvedor).toBe(true);
      expect(result.statusAlterado).toBe(true);
      expect(result.status).toBe(NfseStatus.AUTHORIZED);
      expect(result.numero).toBe(1);
      expect(prisma.nfse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NfseStatus.AUTHORIZED,
            numero: 1,
            motivoRejeicao: null,
          }),
        }),
      );
    });

    it('RPS ausente no provedor: PROCESSING vira REJECTED', async () => {
      // Emissão que falhou no transporte — nenhuma nota foi gerada.
      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        status: NfseStatus.PROCESSING,
        numero: 0,
        rpsNumero: 32,
        rpsSerie: '1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockResolvedValue([
        { Codigo: 100, Documentos: [] },
      ]);
      prisma.nfse.update.mockResolvedValue({ ...mockNfse });

      const result = await service.consultStatus(mockNfseId, mockCompanyId);

      expect(result.encontradoNoProvedor).toBe(false);
      expect(result.status).toBe(NfseStatus.REJECTED);
      expect(result.statusAlterado).toBe(true);
    });

    it('consulta o provedor pela faixa do próprio RPS', async () => {
      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        rpsNumero: 32,
        rpsSerie: '1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockResolvedValue([
        { Codigo: 100, Documentos: [] },
      ]);
      prisma.nfse.update.mockResolvedValue({ ...mockNfse });

      await service.consultStatus(mockNfseId, mockCompanyId);

      expect(invoicyApiService.consultNfse).toHaveBeenCalledWith(
        mockCompanyId,
        32,
        32,
        '1',
        2,
        'config-1',
      );
    });
  });

  describe('getPdfUrl', () => {
    it('should return PDF URL', async () => {
      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        pdfUrl: 'https://invoicy.com/pdf/123',
      });

      const result = await service.getPdfUrl(mockNfseId, mockCompanyId);

      expect(result.url).toBe('https://invoicy.com/pdf/123');
    });
  });
});

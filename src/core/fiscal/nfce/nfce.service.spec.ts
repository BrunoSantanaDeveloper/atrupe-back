import { Test, TestingModule } from '@nestjs/testing';
import { NfceService } from './nfce.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { NfceStatus, OrderStatus, Prisma } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockNfceId = 'nfce-uuid-789';
const mockOrderId = 'order-uuid-123';
const mockQuotationId = 'quotation-uuid-123';

const mockProductFiscalData = [
  {
    productId: '1',
    ncm: '12345678',
    cfopInState: '5102',
    commercialUnit: 'UN',
    icmsCst: '102',
    pisCst: '49',
    cofinsCst: '49',
  },
];

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

// As conferências de empresa (assertBelongsToCompany) acham todos os ids
// pedidos, salvo quando o teste diz o contrário
const allFound = () =>
  jest.fn(async (args: any) => args?.where?.id?.in?.length ?? 0);

const mockPrismaService = {
  company: { findUnique: jest.fn() },
  order: { findFirst: jest.fn() },
  quotation: { count: allFound() },
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
  $executeRaw: jest.fn().mockResolvedValue(1),
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
  resolveEnvironmentFromConfig: jest.fn().mockReturnValue('HOMOLOGACAO'),
  getEmissorCredentialsForValidation: jest.fn().mockResolvedValue({
    cscId: '1',
    cscToken: 'CSC_TOKEN_TESTE',
    nfceSeries: 1,
    nfceNextNumber: 1,
  }),
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
    // Número reservado livre, salvo quando o teste diz o contrário.
    mockPrismaService.nfce.findUnique.mockResolvedValue(null);

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
      prisma.productFiscalData.findMany.mockResolvedValue(
        mockProductFiscalData,
      );
      prisma.order.findFirst.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.IN_PRODUCTION,
        quotationId: mockQuotationId,
        nfes: [],
        nfeOrders: [],
        nfses: [],
        nfces: [],
      });
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

    /**
     * A prévia roda o mesmo montador da emissão. Se alguém acrescentar uma
     * regra só no caminho da emissão, o cupom passa a sair diferente do que o
     * usuário conferiu — e é este teste que quebra.
     */
    describe('preview', () => {
      const dtoPrevia = {
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
      } as any;

      beforeEach(() => {
        // dhEmi vem de `new Date()`: sem relógio fixo, prévia e emissão
        // diferem por milissegundos.
        jest.useFakeTimers().setSystemTime(new Date('2026-09-08T12:00:00Z'));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('gera payload idêntico ao da emissão', async () => {
        const previa = await service.preview(mockCompanyId, dtoPrevia);
        await service.emit(mockCompanyId, dtoPrevia);

        expect(previa.payloadInvoicy).toEqual(
          invoicyApiService.emitNfe.mock.calls.at(-1)[1][0],
        );
      });

      it('não reserva número, não cria registro e não chama o provedor', async () => {
        await service.preview(mockCompanyId, dtoPrevia);

        expect(
          mockFiscalCredentialResolver.reserveNfceNumber,
        ).not.toHaveBeenCalled();
        expect(prisma.nfce.create).not.toHaveBeenCalled();
        expect(prisma.nfce.update).not.toHaveBeenCalled();
        expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
      });

      it('usa o próximo número do emissor e avisa que ele é previsto', async () => {
        const previa = await service.preview(mockCompanyId, dtoPrevia);

        expect(previa.documento?.numeroPrevisto).toBe(1);
        expect(previa.avisos.join(' ')).toMatch(/previsto/i);
      });

      /** A prévia abre mesmo com a nota inválida: é para isso que ela serve. */
      it('devolve os bloqueios em vez de lançar', async () => {
        const previa = await service.preview(mockCompanyId, {
          ...dtoPrevia,
          pagamentos: [{ tipo: '01', valor: 1 }],
        });

        expect(previa.podeEmitir).toBe(false);
        expect(previa.bloqueios.join(' ')).toMatch(/pagamentos/i);
        expect(previa.payloadInvoicy).toBeUndefined();
      });
    });

    /**
     * Mesma ramificação da NF-e: o Simples segue enviando só os códigos, e ligar
     * o motor não altera nenhuma nota de quem emite hoje.
     */
    describe('Regime Normal x Simples Nacional', () => {
      const itemPadrao = {
        productId: '1',
        codigo: '001',
        descricao: 'Produto',
        ncm: '12345678',
        cfop: '5102',
        unidade: 'UN',
        quantidade: 1,
        valorUnitario: 100,
      };
      const dtoPadrao = {
        naturezaOperacao: 'Venda',
        itens: [itemPadrao],
        pagamentos: [{ tipo: '01', valor: 100 }],
      } as any;

      const comRegime = async (emitCrt: number) => {
        const base = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({ ...base, emitCrt });
      };

      const impostoEnviado = () =>
        invoicyApiService.emitNfe.mock.calls.at(-1)[1][0].Documento.det[0]
          .imposto;

      it('mantém apenas os códigos no Simples Nacional', async () => {
        await comRegime(1);
        await service.emit(mockCompanyId, dtoPadrao);

        expect(impostoEnviado().ICMS).not.toHaveProperty('vICMS_icms');
      });

      it('calcula e destaca o imposto no Regime Normal', async () => {
        await comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: '1',
            ncm: '12345678',
            cfopInState: '5102',
            commercialUnit: 'UN',
            icmsCst: '00',
            icmsOrigin: '0',
            icmsRate: 18,
            pisCst: '01',
            pisRate: 1.65,
            cofinsCst: '01',
            cofinsRate: 7.6,
          },
        ]);

        await service.emit(mockCompanyId, dtoPadrao);

        expect(impostoEnviado().ICMS).toMatchObject({
          CST: '00',
          vBC: 100,
          pICMS: 18,
          vICMS_icms: 18,
        });
      });

      it('barra a emissão do Regime Normal quando falta alíquota', async () => {
        await comRegime(3);
        prisma.productFiscalData.findMany.mockResolvedValue([
          {
            productId: '1',
            ncm: '12345678',
            cfopInState: '5102',
            commercialUnit: 'UN',
            icmsCst: '00',
            pisCst: '49',
            cofinsCst: '49',
          },
        ]);

        await expect(service.emit(mockCompanyId, dtoPadrao)).rejects.toThrow(
          /alíquota de ICMS/,
        );
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

    it('orçamento de outra empresa no corpo, sem a ordem: 404 antes de emitir', async () => {
      prisma.quotation.count.mockResolvedValueOnce(0);

      await expect(
        service.emit(mockCompanyId, {
          quotationId: 'orcamento-de-outra-empresa',
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
        } as any),
      ).rejects.toThrow(new NotFoundException('Orçamento não encontrado.'));
      expect(prisma.quotation.count).toHaveBeenCalledWith({
        where: {
          id: { in: ['orcamento-de-outra-empresa'] },
          companyId: mockCompanyId,
        },
      });
      expect(prisma.nfce.create).not.toHaveBeenCalled();
    });

    it('should persist orderId when emitting from an order', async () => {
      await service.emit(mockCompanyId, {
        orderId: mockOrderId,
        quotationId: mockQuotationId,
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

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: mockOrderId,
            quotation: { companyId: mockCompanyId },
          },
        }),
      );
      expect(prisma.nfce.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: mockOrderId,
            quotationId: mockQuotationId,
          }),
        }),
      );
    });

    it('should reject NFC-e when linked order is not found for company', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.emit(mockCompanyId, {
          orderId: mockOrderId,
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
      ).rejects.toThrow(NotFoundException);

      expect(invoicyService.getConfig).toHaveBeenCalledWith(mockCompanyId);
    });

    it('should reject NFC-e when linked order is canceled', async () => {
      prisma.order.findFirst.mockResolvedValueOnce({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
        quotationId: mockQuotationId,
        nfes: [],
        nfeOrders: [],
        nfses: [],
        nfces: [],
      });

      await expect(
        service.emit(mockCompanyId, {
          orderId: mockOrderId,
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

    it('should reject NFC-e when linked order already has an active fiscal document', async () => {
      prisma.order.findFirst.mockResolvedValueOnce({
        id: mockOrderId,
        status: OrderStatus.IN_PRODUCTION,
        quotationId: mockQuotationId,
        nfes: [],
        nfeOrders: [],
        nfses: [],
        nfces: [{ id: 'nfce-existing', status: NfceStatus.AUTHORIZED }],
      });

      await expect(
        service.emit(mockCompanyId, {
          orderId: mockOrderId,
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
      ).rejects.toThrow(ConflictException);
    });

    it('should validate payment change against discounted total', async () => {
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
            valorDesconto: 10,
          },
        ],
        pagamentos: [{ tipo: '01', valor: 100 }],
        valorTroco: 10,
      });

      const request = invoicyApiService.emitNfe.mock.calls[0][1][0];
      expect(request.Documento.total.ICMStot.vProd_ttlnfe).toBe('100.00');
      expect(request.Documento.total.ICMStot.vDesc_ttlnfe).toBe('10.00');
      expect(request.Documento.total.ICMStot.vNF).toBe('90.00');
    });

    it('should reject inconsistent payment change', async () => {
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
          pagamentos: [{ tipo: '01', valor: 120 }],
          valorTroco: 0,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockFiscalCredentialResolver.reserveNfceNumber,
      ).not.toHaveBeenCalled();
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

    it('should release reserved number when SEFAZ conclusively rejects', async () => {
      invoicyApiService.emitNfe.mockResolvedValueOnce([
        {
          Codigo: 100,
          Descricao: 'Documentos processados',
          Documentos: [
            {
              DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
              DocProtocolo: null,
              DocIDUnico: 'invoicy-id-rejected',
              DocPDFDownload: null,
              DocCompleto: null,
              Situacao: {
                SitCodigo: 999,
                SitDescricao: 'Rejeição 999: CNPJ do emitente inválido',
              },
            },
          ],
        },
      ]);

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

      // O número reservado deve ser devolvido à sequência após rejeição conclusiva
      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should NOT release reserved number on transport failure (UNKNOWN outcome)', async () => {
      const transportError = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      });
      invoicyApiService.emitNfe.mockRejectedValueOnce(transportError);

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

      // Falha de transporte: resultado incerto, não devolver o número
      expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('should NOT release reserved number on successful authorization', async () => {
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

      // Autorizado: número já pertence à nota, não devolver
      expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('recusa do provedor (Codigo ≠ 100): REJECTED com o motivo do Invoicy e número devolvido', async () => {
      // Caso de produção (16/10/2026): o Invoicy respondeu 607 em HTTP 200 e
      // a NFC-e ficava em UNKNOWN com "falha de comunicação".
      invoicyApiService.emitNfe.mockResolvedValueOnce([
        {
          Codigo: 607,
          Descricao:
            'A licença da sua empresa está CANCELADA e não será mais possível emitir este tipo de documento.',
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
      expect(error.message).toContain('CANCELADA');
      expect(error.message).not.toContain('Falha de comunicação');

      const gravado = prisma.nfce.update.mock.calls.at(-1)[0].data;
      expect(gravado.status).toBe(NfceStatus.REJECTED);
      expect(gravado.motivoRejeicao).toContain('código 607');

      // O lote não chegou à SEFAZ: o número continua livre e volta à
      // sequência; a próxima emissão reaproveita a linha REJECTED.
      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);
    });

    /**
     * Caso de 23/10/2026: a nota chegou à SEFAZ e voltou "Emissor nao
     * habilitado"; antes disso o provedor tinha recusado com 607. Os dois
     * textos crus não dizem a quem recorrer, e o usuário achou que o problema
     * era no Atrupe.
     */
    describe('orientação quando a providência está fora da nota', () => {
      const dto = {
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
      };

      it('203: grava o retorno da SEFAZ e, depois de uma linha em branco, o que fazer', async () => {
        invoicyApiService.emitNfe.mockResolvedValueOnce([
          {
            Codigo: 100,
            Descricao: 'Documentos processados',
            Documentos: [
              {
                DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
                DocProtocolo: null,
                Situacao: {
                  SitCodigo: 203,
                  SitDescricao:
                    'Rejeicao: Emissor nao habilitado para emissao da NF-e/NFC-e',
                },
              },
            ],
          },
        ]);

        const error = await service.emit(mockCompanyId, dto).catch((e) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.message).toContain(
          'O que fazer (habilitação na SEFAZ, fora do Atrupe)',
        );

        const motivo = prisma.nfce.update.mock.calls.at(-1)[0].data
          .motivoRejeicao as string;
        expect(motivo).toMatch(
          /^Rejeicao: Emissor nao habilitado para emissao da NF-e\/NFC-e\n\nO que fazer \(habilitação na SEFAZ/,
        );
        expect(motivo).toContain('CSC ativo');
      });

      it('607: a recusa do provedor diz que nada foi à SEFAZ e quem reativa a licença', async () => {
        invoicyApiService.emitNfe.mockResolvedValueOnce([
          {
            Codigo: 607,
            Descricao:
              'A licença da sua empresa está CANCELADA e não será mais possível emitir este tipo de documento.',
          },
        ]);

        const error = await service.emit(mockCompanyId, dto).catch((e) => e);

        expect(error.message).toContain('suporte da Atrupe');
        const motivo = prisma.nfce.update.mock.calls.at(-1)[0].data
          .motivoRejeicao as string;
        expect(motivo).toContain(
          '(código 607)\n\nO que fazer (licença no provedor fiscal)',
        );
        expect(motivo).toContain('nada foi enviado à SEFAZ');
      });

      it('rejeição sem entrada na lista fica como a SEFAZ mandou', async () => {
        invoicyApiService.emitNfe.mockResolvedValueOnce([
          {
            Codigo: 100,
            Descricao: 'Documentos processados',
            Documentos: [
              {
                DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
                DocProtocolo: null,
                Situacao: {
                  SitCodigo: 999,
                  SitDescricao: 'Rejeicao: CFOP invalido',
                },
              },
            ],
          },
        ]);

        const error = await service.emit(mockCompanyId, dto).catch((e) => e);

        expect(error.message).toBe('NFC-e rejeitada: Rejeicao: CFOP invalido');
        expect(
          prisma.nfce.update.mock.calls.at(-1)[0].data.motivoRejeicao,
        ).toBe('Rejeicao: CFOP invalido');
      });
    });

    describe('número devolvido à sequência', () => {
      const dtoSimples = {
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
      };

      it('reaproveita a linha da tentativa rejeitada em vez de criar outra', async () => {
        // Antes o create batia no unique nfce_unique_emission e toda emissão
        // seguinte do emissor falhava no mesmo número (P2002).
        prisma.nfce.findUnique.mockResolvedValueOnce({
          id: 'nfce-rejeitada',
          status: NfceStatus.REJECTED,
          protocolo: null,
        });

        await service.emit(mockCompanyId, dtoSimples);

        expect(prisma.nfce.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              nfce_unique_emission: {
                companyId: mockCompanyId,
                numero: 1,
                serie: 1,
                ambiente: 2,
              },
            },
          }),
        );
        expect(prisma.nfce.create).not.toHaveBeenCalled();

        const [reaproveitamento] = prisma.nfce.update.mock.calls[0];
        expect(reaproveitamento.where).toEqual({
          id: 'nfce-rejeitada',
          status: NfceStatus.REJECTED,
          protocolo: null,
        });
        expect(reaproveitamento.data).toEqual(
          expect.objectContaining({
            status: NfceStatus.PROCESSING,
            chaveAcesso: null,
            motivoRejeicao: null,
            xmlAutorizado: null,
            orderId: null,
            invoicyPayloadEnvio: expect.any(Object),
            createdAt: expect.any(Date),
          }),
        );

        // Toda coluna é reescrita: uma coluna nova que ficasse de fora levaria
        // o valor da tentativa rejeitada para a nova emissão.
        const colunas = Object.values(Prisma.NfceScalarFieldEnum).filter(
          (coluna) => coluna !== 'id' && coluna !== 'updatedAt',
        );
        expect(Object.keys(reaproveitamento.data).sort()).toEqual(
          [...colunas].sort(),
        );
      });

      it.each([
        [
          'nota autorizada',
          { status: NfceStatus.AUTHORIZED, protocolo: '135260000000001' },
        ],
        [
          'nota com resultado desconhecido',
          { status: NfceStatus.UNKNOWN, protocolo: null },
        ],
        [
          'nota em contingência',
          { status: NfceStatus.CONTINGENCY, protocolo: null },
        ],
        [
          'rejeição com protocolo (denegação)',
          { status: NfceStatus.REJECTED, protocolo: '135260000000002' },
        ],
      ])(
        'número ocupado por %s: Conflict acionável, sem transmitir',
        async (_caso, ocupante) => {
          prisma.nfce.findUnique.mockResolvedValueOnce({
            id: 'nfce-ocupante',
            ...ocupante,
          });

          const error = await service
            .emit(mockCompanyId, dtoSimples)
            .catch((e) => e);

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.message).toContain('Ajuste o próximo número');
          expect(prisma.nfce.create).not.toHaveBeenCalled();
          expect(prisma.nfce.update).not.toHaveBeenCalled();
          expect(invoicyApiService.emitNfe).not.toHaveBeenCalled();
        },
      );

      it.each([
        [
          'duplicidade (539)',
          {
            SitCodigo: 539,
            SitDescricao:
              'Rejeição: Duplicidade de NF-e com diferença na Chave de Acesso',
          },
        ],
        ['denegação (110)', { SitCodigo: 110, SitDescricao: 'Uso Denegado' }],
        ['resposta sem cStat', undefined],
      ])('%s não devolve o número', async (_caso, situacao) => {
        invoicyApiService.emitNfe.mockResolvedValueOnce([
          {
            Codigo: 100,
            Descricao: 'Documentos processados',
            Documentos: [
              {
                DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
                DocProtocolo: null,
                Situacao: situacao,
              },
            ],
          },
        ]);

        await expect(service.emit(mockCompanyId, dtoSimples)).rejects.toThrow(
          BadRequestException,
        );

        // O número tem dono na SEFAZ (ou não há prova de que não tenha):
        // devolvê-lo levaria a próxima emissão à mesma recusa.
        expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
      });

      it('rejeição em contingência não devolve o número: a linha segue como documento', async () => {
        const configPadrao = await invoicyService.getConfig(mockCompanyId);
        invoicyService.getConfig.mockResolvedValueOnce({
          ...configPadrao,
          contingenciaNfceAtiva: true,
        });
        invoicyApiService.emitNfe.mockResolvedValueOnce([
          {
            Codigo: 100,
            Descricao: 'Documentos processados',
            Documentos: [
              {
                DocChaAcesso: mockInvoicyResponse.data.chaveAcesso,
                DocProtocolo: null,
                Situacao: { SitCodigo: 999, SitDescricao: 'Rejeição 999' },
              },
            ],
          },
        ]);

        await service.emit(mockCompanyId, dtoSimples).catch(() => undefined);

        expect(prisma.nfce.update.mock.calls.at(-1)[0].data.status).toBe(
          NfceStatus.CONTINGENCY,
        );
        expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();
      });
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

      // O emissor é repassado para que a inutilização resolva credenciais e
      // ambiente do emissor correto, não do padrão da empresa.
      expect(invoicyApiService.inutilizarNfce).toHaveBeenCalledWith(
        mockCompanyId,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(String),
        'config-1',
      );
    });

    it('exige ambiente ativado antes de inutilizar', async () => {
      mockFiscalCredentialResolver.assertEnvironmentReady.mockRejectedValueOnce(
        new Error('ambiente não ativado'),
      );

      await expect(
        service.inutilizar(mockCompanyId, {
          numeroInicial: 1,
          numeroFinal: 5,
          justificativa: 'Numeração perdida por falha técnica',
        }),
      ).rejects.toThrow();

      expect(invoicyApiService.inutilizarNfce).not.toHaveBeenCalled();
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
      prisma.productFiscalData.findMany.mockResolvedValue(
        mockProductFiscalData,
      );
      prisma.order.findFirst.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.IN_PRODUCTION,
        quotationId: mockQuotationId,
        nfes: [],
        nfeOrders: [],
        nfses: [],
        nfces: [],
      });
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

    it('erro de programação: não é tratado como falha de transporte', async () => {
      // Um RangeError não tem error.response, o que antes o classificava como
      // "resultado desconhecido" e deixava a NFC-e em UNKNOWN.
      invoicyApiService.emitNfe.mockRejectedValueOnce(
        new RangeError('Invalid time value'),
      );

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
      expect(error.message).not.toContain('Falha de comunicação');
      expect(error.message).toContain('Invalid time value');

      const statusGravado = prisma.nfce.update.mock.calls.at(-1)[0].data.status;
      expect(statusGravado).toBe(NfceStatus.REJECTED);
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

      // O 4º argumento é o ambiente já resolvido para o payload: o transporte
      // não pode reabrir essa decisão e cair no campo global activeEnvironment.
      expect(invoicyApiService.emitNfe).toHaveBeenCalledWith(
        mockCompanyId,
        expect.any(Array),
        'config-1',
        'HOMOLOGACAO',
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
        'HOMOLOGACAO',
      );
    });

    it('recusa do provedor no reenvio: mantém UNKNOWN e repassa o motivo', async () => {
      prisma.nfce.findFirst.mockResolvedValueOnce(unknownNfce);
      prisma.invoicyConfig.findFirst.mockResolvedValueOnce({ id: 'config-1' });
      invoicyApiService.emitNfe.mockResolvedValueOnce([
        {
          Codigo: 607,
          Descricao:
            'A licença da sua empresa está CANCELADA e não será mais possível emitir este tipo de documento.',
        },
      ]);

      const error = await service
        .reprocess(mockNfceId, mockCompanyId)
        .catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('CANCELADA');
      expect(error.message).not.toContain('Falha de comunicacao');

      // A recusa é do reenvio; o resultado da transmissão original segue
      // desconhecido, então a nota não pode virar REJECTED.
      const gravado = prisma.nfce.update.mock.calls.at(-1)[0].data;
      expect(gravado.status).toBe(NfceStatus.UNKNOWN);
      expect(gravado.motivoRejeicao).toContain('código 607');
    });
  });
});

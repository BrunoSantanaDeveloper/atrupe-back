import { Test, TestingModule } from '@nestjs/testing';
import { NfseService } from './nfse.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { MailService } from '../../mail/mail.service';
import { ProductFiscalService } from '../product-fiscal/product-fiscal.service';
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
        {
          provide: ProductFiscalService,
          useValue: { avaliarCadastroFiscal: jest.fn().mockReturnValue([]) },
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

    /**
     * cIndOp e' obrigatorio no layout da Reforma e estavel para a maioria dos
     * emissores — sem padrao, o usuario digitava a cada nota.
     */
    /**
     * A prévia roda o mesmo montador do RPS que a emissão. Se alguém
     * acrescentar uma regra só no caminho da emissão, a nota passa a sair
     * diferente do que o usuário conferiu — e é este teste que quebra.
     */
    describe('preview', () => {
      const dtoDaOrdem = {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Servico de consultoria em TI',
      };

      beforeEach(() => {
        // dEmis/dCompetencia usam `new Date()`: sem relógio fixo, prévia e
        // emissão diferem por milissegundos.
        jest.useFakeTimers().setSystemTime(new Date('2026-09-08T12:00:00Z'));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      const rpsEnviado = () =>
        invoicyApiService.emitNfse.mock.calls.at(-1)[1][0];

      it('gera o mesmo RPS que a emissão a partir da ordem', async () => {
        const previa = await service.previewFromOrder(
          mockCompanyId,
          dtoDaOrdem as any,
        );
        await service.emitFromOrder(mockCompanyId, dtoDaOrdem as any);

        expect(previa.payloadInvoicy).toEqual(rpsEnviado());
      });

      it('não reserva RPS, não cria registro e não chama a prefeitura', async () => {
        await service.previewFromOrder(mockCompanyId, dtoDaOrdem as any);

        expect(
          mockFiscalCredentialResolver.reserveNfseRpsNumber,
        ).not.toHaveBeenCalled();
        expect(prisma.nfse.create).not.toHaveBeenCalled();
        expect(prisma.nfse.update).not.toHaveBeenCalled();
        expect(invoicyApiService.emitNfse).not.toHaveBeenCalled();
      });

      it('usa o próximo RPS do emissor e diz que ele é previsto', async () => {
        const previa = await service.previewFromOrder(
          mockCompanyId,
          dtoDaOrdem as any,
        );

        expect(previa.documento?.rpsPrevisto).toBe(1);
        expect(previa.documento?.rpsSerie).toBe('A1');
        // Quem numera a NFS-e é a prefeitura, no retorno da recepção.
        expect(previa.documento?.numeroNfse).toBeNull();
        expect(previa.avisos.join(' ')).toMatch(/previsto/i);
      });

      it('avisa que os reenvios automáticos podem alterar o payload', async () => {
        const previa = await service.previewFromOrder(
          mockCompanyId,
          dtoDaOrdem as any,
        );

        expect(previa.avisos.join(' ')).toMatch(/E0120/);
        expect(previa.avisos.join(' ')).toMatch(/E0166/);
      });

      /** A prévia abre mesmo com a nota inválida: é para isso que ela serve. */
      it('devolve os bloqueios em vez de lançar', async () => {
        mockInvoicyService.getConfig.mockResolvedValue({
          ...(await mockInvoicyService.getConfig()),
          aliquotaIss: null,
        });

        const previa = await service.preview(mockCompanyId, {
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
          valorServicos: 100,
          naturezaOperacao: 1,
        } as any);

        expect(previa.podeEmitir).toBe(false);
        expect(previa.bloqueios.join(' ')).toMatch(/Alíquota de ISS/i);
        expect(previa.payloadInvoicy).toBeUndefined();
      });
    });

    describe('indicador de operacao (cIndOp)', () => {
      const rpsEnviado = () =>
        mockInvoicyApiService.emitNfse.mock.calls.at(-1)[1][0].Documento.RPS[0];

      const comIndicadorPadrao = async (indicadorOperacaoNfse: unknown) => {
        const configBase = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({
          ...configBase,
          indicadorOperacaoNfse,
        });
      };

      it('usa o padrao do emissor quando a emissao nao informa', async () => {
        await comIndicadorPadrao('100301');

        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Servico de consultoria em TI',
        });

        expect(rpsEnviado().cIndOp).toBe('100301');
      });

      it('deixa a emissao sobrepor o padrao', async () => {
        await comIndicadorPadrao('100301');

        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Servico de consultoria em TI',
          cIndOp: '100999',
        });

        expect(rpsEnviado().cIndOp).toBe('100999');
      });

      /** Emissor sem padrao segue como antes: o campo simplesmente nao vai. */
      it('omite o campo quando nao ha padrao nem valor na emissao', async () => {
        await comIndicadorPadrao(null);

        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Servico de consultoria em TI',
        });

        expect(rpsEnviado()).not.toHaveProperty('cIndOp');
      });
    });

    describe('reenvio do E0166 (RegApuracao)', () => {
      const rejeicaoE0166 = [
        {
          Codigo: 100,
          Descricao: 'Documentos processados com sucesso',
          Documentos: [
            {
              Situacao: {
                SitCodigo: 2,
                SitDescricao:
                  'Pendente - Mensagem retornada pela prefeitura: Codigo: E0166, Mensagem: Regime de apuracao obrigatorio',
              },
            },
          ],
        },
      ];

      /**
       * Emissor com `emitCrt` nulo e' o caso que motivou o fallback: o payload
       * nao leva regApTribSN, a prefeitura recusa, e o reenvio o acrescenta.
       * Com CRT 1 o campo ja' vai no primeiro envio e nao ha' o que reenviar.
       */
      it('reenvia declarando o Simples quando o emissor nao tem CRT definido', async () => {
        const configBase = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({
          ...configBase,
          emitCrt: null,
        });
        mockInvoicyApiService.emitNfse
          .mockResolvedValueOnce(rejeicaoE0166)
          .mockResolvedValueOnce(mockInvoicyResponse);

        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Servico de consultoria em TI',
        });

        expect(invoicyApiService.emitNfse).toHaveBeenCalledTimes(2);
        const reenvio =
          mockInvoicyApiService.emitNfse.mock.calls[1][1][0].Documento.RPS[0];
        expect(reenvio.regApTribSN).toBe(1);
        expect(reenvio.OptSN).toBe(1);
      });

      /**
       * O reenvio declara a empresa como ME/EPP optante do Simples. Para um
       * emissor do Regime Normal isso e' declaracao falsa numa nota fiscal —
       * a rejeicao tem de subir em vez de ser contornada.
       */
      it('nao reenvia declarando Simples para emissor do Regime Normal', async () => {
        const configBase = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({
          ...configBase,
          emitCrt: 3,
        });
        mockInvoicyApiService.emitNfse.mockResolvedValue(rejeicaoE0166);

        // A rejeicao sobe para o usuario: e' ele quem sabe o que o municipio
        // exige de uma empresa fora do Simples.
        await expect(
          service.emitFromOrder(mockCompanyId, {
            orderId: mockOrderId,
            codigoServico: '1.05',
            discriminacao: 'Servico de consultoria em TI',
          }),
        ).rejects.toThrow(/E0166/);

        expect(invoicyApiService.emitNfse).toHaveBeenCalledTimes(1);
        const enviado =
          mockInvoicyApiService.emitNfse.mock.calls[0][1][0].Documento.RPS[0];
        expect(enviado.OptSN).toBe(2);
        expect(enviado.regApTribSN).toBeUndefined();
      });

      /**
       * O reenvio acrescenta regApTribSN e RegEspTrib 6, que sao os campos de
       * ME/EPP. Para um MEI isso trocaria o regime dele por outro so' para
       * vencer a rejeicao — o payload dele ja' sai completo, com OptSN 1 e
       * RegEspTrib 5, entao nao ha' o que reenviar.
       */
      it('nao reenvia declarando ME/EPP para emissor MEI', async () => {
        const configBase = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({
          ...configBase,
          emitCrt: 4,
          regimeEspecialTributacao: null,
        });
        mockInvoicyApiService.emitNfse.mockResolvedValue(rejeicaoE0166);

        await expect(
          service.emitFromOrder(mockCompanyId, {
            orderId: mockOrderId,
            codigoServico: '1.05',
            discriminacao: 'Servico de consultoria em TI',
          }),
        ).rejects.toThrow(/E0166/);

        expect(invoicyApiService.emitNfse).toHaveBeenCalledTimes(1);
        const enviado =
          mockInvoicyApiService.emitNfse.mock.calls[0][1][0].Documento.RPS[0];
        expect(enviado.OptSN).toBe(1);
        expect(enviado.RegEspTrib).toBe(5);
        expect(enviado.regApTribSN).toBeUndefined();
      });
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

    it('omite a alíquota para ME/EPP do Simples sem retenção de ISSQN', async () => {
      // E0625: com opSimpNac=3 e tpRetISSQN=1 a prefeitura recusa pAliq.
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
        valorServicos: 100,
        aliquotaIss: 2.5,
        issRetido: false,
        naturezaOperacao: 1,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      expect(rps.Servico.Valores).not.toHaveProperty('ValAliqISS');
      expect(rps.ListaItens[0]).not.toHaveProperty('ItemAliquota');
    });

    it('mantém a alíquota quando o ISSQN é retido pelo tomador', async () => {
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
        valorServicos: 100,
        aliquotaIss: 2.5,
        issRetido: true,
        naturezaOperacao: 1,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      expect(rps.Servico.Valores.ValAliqISS).toBe(2.5);
      expect(rps.ListaItens[0].ItemAliquota).toBe(2.5);
    });

    it('envia a classificação fiscal cadastrada no serviço', async () => {
      // NBS, cód. nacional/municipal, CNAE e classificação IBS/CBS já eram
      // cadastrados em ProductFiscalData e descartados na montagem do payload.
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
            product: {
              ...mockOrder.items[0].product,
              fiscalData: {
                codigoServico: '1.05',
                aliquotaIss: 5,
                discriminacao: 'Serviço de consultoria em TI',
                nbs: '121012200',
                codTribNacional: '230101',
                codTribMunicipio: '001',
                cnae: '329900',
                cstIbsCbs: '000',
                codClassificacao: '000001',
              },
            },
          },
        ],
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const servico = documentos[0].Documento.RPS[0].Servico;

      expect(servico.CodigoNBS).toBe('121012200');
      expect(servico.codTributNacional).toBe('230101');
      expect(servico.Cnae).toBe(329900);
      // O grupo precisa sair completo: CSTIBSCBS é obrigatório junto de
      // cClassTrib no schema do provedor.
      expect(servico.IBSCBS).toEqual({
        CSTIBSCBS: '000',
        cClassTrib: '000001',
      });
      expect(servico.CodigoNBS).toBe('121012200');
      // Código de tributação do município vai como texto, com os zeros: o
      // DPS nacional exige cTribMun de 3 dígitos. Como número (1) o InvoiCy
      // o descartava e o Rio recusava 130501 com E0312.
      expect(servico.TributMunicipio).toBe('001');
      const [item] = documentos[0].Documento.RPS[0].ListaItens;
      expect(item.ItemTributMunicipio).toBe('001');
    });

    it('omite a classificação fiscal quando o serviço não a cadastra', async () => {
      // Sem cadastro o payload não pode mudar: quem emite hoje continua igual.
      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const servico = documentos[0].Documento.RPS[0].Servico;

      expect(servico).not.toHaveProperty('CodigoNBS');
      expect(servico).not.toHaveProperty('codTributNacional');
      expect(servico).not.toHaveProperty('IBSCBS');
      expect(servico.TributMunicipio).toBe(4314902);
      expect(
        documentos[0].Documento.RPS[0].ListaItens[0].ItemTributMunicipio,
      ).toBe(4314902);
    });

    /**
     * O schema InvoiCy_NFSe_Reforma_tributaria.xsd marca CSTIBSCBS como
     * obrigatório dentro de IBSCBS. Enviar apenas cClassTrib gera grupo
     * incompleto — a mesma classe de defeito que causou a rejeição de schema
     * em locPrest (E1235). Como codClassificacao tem valor padrão no cadastro,
     * isso saía em praticamente toda NFS-e.
     */
    /**
     * O grupo de valores do IBS/CBS é opcional no layout e o retorno do
     * provedor não devolve esses valores. Ligá-lo por engano mudaria a nota de
     * todo mundo, então o default tem de continuar desligado.
     */
    /**
     * Fora do Simples não há regime especial a declarar. O padrão anterior
     * mandava 1 = "Microempresa Municipal" para qualquer não-optante, o que é
     * falso para uma empresa de Lucro Presumido ou Real.
     */
    describe('regime especial de tributação', () => {
      const regimeEnviado = () => {
        const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
        return documentos[0].Documento.RPS[0];
      };

      const emitirCom = async (patch: Record<string, unknown>) => {
        const base = await mockInvoicyService.getConfig();
        mockInvoicyService.getConfig.mockResolvedValue({ ...base, ...patch });
        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Serviço de consultoria em TI',
        });
      };

      it('declara ME/EPP do Simples para optante', async () => {
        await emitirCom({ emitCrt: 1, regimeEspecialTributacao: null });
        expect(regimeEnviado().RegEspTrib).toBe(6);
      });

      it('omite a tag fora do Simples em vez de declarar microempresa municipal', async () => {
        await emitirCom({ emitCrt: 3, regimeEspecialTributacao: null });
        expect(regimeEnviado()).not.toHaveProperty('RegEspTrib');
      });

      it('respeita o regime configurado no emissor', async () => {
        await emitirCom({ emitCrt: 3, regimeEspecialTributacao: 4 });
        expect(regimeEnviado().RegEspTrib).toBe(4);
      });

      /**
       * MEI tem faixa propria na tabela do provedor (5), diferente do 6 de
       * ME/EPP, e e' optante — mandar OptSN 2 contradiz o cadastro da empresa
       * no Simples Nacional. Ja' o regApTribSN e' campo de quem ultrapassa
       * sublimite, que o MEI nao tem.
       */
      it('declara MEI com regime 5, como optante e sem regApTribSN', async () => {
        await emitirCom({ emitCrt: 4, regimeEspecialTributacao: null });
        const rps = regimeEnviado();
        expect(rps.RegEspTrib).toBe(5);
        expect(rps.OptSN).toBe(1);
        expect(rps).not.toHaveProperty('regApTribSN');
      });
    });

    it('não envia valores de IBS/CBS enquanto o emissor não habilitar', async () => {
      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const valores = documentos[0].Documento.RPS[0].Servico.Valores;

      expect(valores).not.toHaveProperty('IBSCBS');
    });

    it('envia os valores de IBS/CBS quando o emissor habilita', async () => {
      const configBase = await mockInvoicyService.getConfig();
      mockInvoicyService.getConfig.mockResolvedValue({
        ...configBase,
        ibsCbsEnviarValores: true,
        emitCrt: 1,
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
        valorServicos: 55,
        aliquotaIss: 4.4,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const grupo = documentos[0].Documento.RPS[0].Servico.Valores.IBSCBS;

      // Os percentuais de diferimento são obrigatórios dentro de IBS e CBS.
      expect(grupo.IBS.ValpDifUF).toBe(0);
      expect(grupo.IBS.ValpDifMun).toBe(0);
      expect(grupo.CBS.ValpDifCBS).toBe(0);
      // Optante do Simples usa os campos próprios, nunca os do regime regular.
      expect(grupo.IBS).toHaveProperty('ValIBSSN');
      expect(grupo.IBS).not.toHaveProperty('ValIBSTot');
      expect(grupo.CBS).toHaveProperty('ValCBSSN');
      expect(grupo.CBS).not.toHaveProperty('ValCBS');
      expect(typeof grupo.ValBCIBSCBS).toBe('number');
    });

    /**
     * regApIBSCBSSN decide POR TRIBUTO qual regime apura. No regime 2 a CBS
     * sai pelos campos do Simples e o IBS pelos do regime regular — um
     * booleano único produziria a combinação errada.
     */
    it('separa IBS e CBS conforme o regime de apuração do Simples', async () => {
      const configBase = await mockInvoicyService.getConfig();
      mockInvoicyService.getConfig.mockResolvedValue({
        ...configBase,
        ibsCbsEnviarValores: true,
        emitCrt: 1,
        regApIbsCbsSn: 2,
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const documentos = mockInvoicyApiService.emitNfse.mock.calls.at(-1)[1];
      const rps = documentos[0].Documento.RPS[0];
      const grupo = rps.Servico.Valores.IBSCBS;

      expect(rps.regApIBSCBSSN).toBe(2);
      // CBS pelo Simples, IBS pelo regime regular.
      expect(grupo.CBS).toHaveProperty('ValCBSSN');
      expect(grupo.CBS).not.toHaveProperty('ValCBS');
      expect(grupo.IBS).toHaveProperty('ValIBSTot');
      expect(grupo.IBS).not.toHaveProperty('ValIBSSN');
    });

    it('usa os campos regulares quando o optante apura tudo pelo regime regular', async () => {
      const configBase = await mockInvoicyService.getConfig();
      mockInvoicyService.getConfig.mockResolvedValue({
        ...configBase,
        ibsCbsEnviarValores: true,
        emitCrt: 1,
        regApIbsCbsSn: 3,
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const rps =
        mockInvoicyApiService.emitNfse.mock.calls.at(-1)[1][0].Documento.RPS[0];
      const grupo = rps.Servico.Valores.IBSCBS;

      expect(rps.regApIBSCBSSN).toBe(3);
      expect(grupo.IBS).toHaveProperty('ValIBSTot');
      expect(grupo.CBS).toHaveProperty('ValCBS');
    });

    it('não envia o grupo IBSCBS pela metade quando falta o CST', async () => {
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
            product: {
              ...mockOrder.items[0].product,
              fiscalData: {
                codigoServico: '1.05',
                aliquotaIss: 5,
                discriminacao: 'Serviço de consultoria em TI',
                codClassificacao: '000001',
                // sem cstIbsCbs
              },
            },
          },
        ],
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const servico = documentos[0].Documento.RPS[0].Servico;

      expect(servico).not.toHaveProperty('IBSCBS');
    });

    it('leva o NBS do serviço para cada item da lista', async () => {
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
            product: {
              ...mockOrder.items[0].product,
              fiscalData: {
                codigoServico: '1.05',
                aliquotaIss: 5,
                discriminacao: 'Serviço de consultoria em TI',
                nbs: '114061100',
                cstIbsCbs: '000',
                codClassificacao: '000001',
              },
            },
          },
        ],
      });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Serviço de consultoria em TI',
      });

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      expect(rps.Servico.CodigoNBS).toBe('114061100');
      for (const item of rps.ListaItens.Item ?? rps.ListaItens) {
        expect(item.ItemNBS).toBe('114061100');
      }
    });

    it('envia os campos da Reforma Tributária quando informados', async () => {
      // Nomes conforme Layout_Recepcao_NFSe_Reforma_Tributaria v4:
      // cIndOp/indFinal/indDest/tpEnteGov/tpOper no RPS; ValRetFederais/
      // Estaduais/Municipais e ValAliqINSS (decimal) em Valores.
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
        valorServicos: 100,
        aliquotaIss: 2.5,
        naturezaOperacao: 1,
        cIndOp: '100301',
        indFinal: 0,
        indDest: 0,
        tpEnteGov: 4,
        tpOper: 1,
        tribAproxFederal: 1.5,
        tribAproxEstadual: 0.5,
        tribAproxMunicipal: 2.5,
        aliquotaInss: 5,
        valorInss: 3.21,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      expect(rps.cIndOp).toBe('100301');
      expect(rps.indFinal).toBe(0);
      expect(rps.indDest).toBe(0);
      expect(rps.tpEnteGov).toBe(4);
      expect(rps.tpOper).toBe(1);
      expect(rps.Servico.Valores.ValRetFederais).toBe(1.5);
      expect(rps.Servico.Valores.ValRetEstaduais).toBe(0.5);
      expect(rps.Servico.Valores.ValRetMunicipais).toBe(2.5);
      // 5% vira 0.05 — o layout pede decimal
      expect(rps.Servico.Valores.ValAliqINSS).toBe(0.05);
      expect(rps.Servico.Valores.ValINSS).toBe(3.21);
    });

    it('omite os campos da Reforma quando não informados', async () => {
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
        valorServicos: 100,
        aliquotaIss: 2.5,
        naturezaOperacao: 1,
      } as any);

      const [, documentos] = invoicyApiService.emitNfse.mock.calls.at(-1);
      const rps = documentos[0].Documento.RPS[0];

      for (const campo of [
        'cIndOp',
        'indFinal',
        'indDest',
        'tpEnteGov',
        'tpOper',
      ]) {
        expect(rps).not.toHaveProperty(campo);
      }
      for (const campo of [
        'ValRetFederais',
        'ValRetEstaduais',
        'ValRetMunicipais',
        'ValAliqINSS',
      ]) {
        expect(rps.Servico.Valores).not.toHaveProperty(campo);
      }
    });

    /**
     * tpOper ("Operação com Entes Governamentais" no InvoiCy Web) e' 0-1 na
     * raiz do RPS e cobre tambem "outros servicos sobre bens imoveis": vale
     * sem ente governamental. O gate antigo (so' com tpEnteGov) descartava o
     * valor nos tres caminhos de emissao.
     */
    describe('tpOper sem tpEnteGov', () => {
      const rpsEnviado = () =>
        invoicyApiService.emitNfse.mock.calls.at(-1)[1][0].Documento.RPS[0];

      it('vai no RPS da emissão avulsa', async () => {
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
          valorServicos: 100,
          aliquotaIss: 2.5,
          naturezaOperacao: 1,
          tpOper: 3,
        } as any);

        expect(rpsEnviado().tpOper).toBe(3);
        expect(rpsEnviado()).not.toHaveProperty('tpEnteGov');
      });

      it('vai no RPS da emissão por ordem', async () => {
        await service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Servico de consultoria em TI',
          tpOper: 3,
        } as any);

        expect(rpsEnviado().tpOper).toBe(3);
        expect(rpsEnviado()).not.toHaveProperty('tpEnteGov');
      });
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

    it('libera a ordem quando o provedor não conhece o RPS em processamento', async () => {
      // Emissão que falhou no transporte fica em PROCESSING e travava a ordem
      // para sempre. Se o provedor não registrou o RPS, não há nota em voo.
      prisma.quotation.findFirst.mockResolvedValueOnce({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: {
          ...mockOrder,
          nfses: [{ id: 'nfse-presa', status: NfseStatus.PROCESSING }],
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

      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        id: 'nfse-presa',
        status: NfseStatus.PROCESSING,
        rpsNumero: 7,
        rpsSerie: 'A1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockResolvedValue([
        { Codigo: 100, Documentos: [] },
      ]);
      prisma.nfse.update.mockResolvedValue({ ...mockNfse });

      await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
        codigoServico: '1.05',
        discriminacao: 'Teste',
      });

      expect(invoicyApiService.consultNfse).toHaveBeenCalled();
      expect(invoicyApiService.emitNfse).toHaveBeenCalled();
    });

    it('mantém o bloqueio quando o provedor conhece o RPS em processamento', async () => {
      prisma.quotation.findFirst.mockResolvedValueOnce({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: {
          ...mockOrder,
          nfses: [{ id: 'nfse-presa', status: NfseStatus.PROCESSING }],
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

      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        id: 'nfse-presa',
        status: NfseStatus.PROCESSING,
        rpsNumero: 7,
        rpsSerie: 'A1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockResolvedValue([
        {
          Codigo: 100,
          Documentos: [
            {
              Situacao: { SitCodigo: 100, SitDescricao: 'NFS-e autorizada' },
              NFSe: { NFSeNumero: 9, NFSeCodVerificacao: 'X' },
            },
          ],
        },
      ]);
      prisma.nfse.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockNfse, ...data }),
      );

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Teste',
        }),
      ).rejects.toThrow(ConflictException);

      expect(invoicyApiService.emitNfse).not.toHaveBeenCalled();
    });

    it('não libera a ordem quando a consulta ao provedor falha', async () => {
      // Sem saber o que aconteceu, bloquear é o lado seguro: nota duplicada
      // na prefeitura é dano permanente.
      prisma.quotation.findFirst.mockResolvedValueOnce({
        id: 'quotation-1',
        companyId: mockCompanyId,
        order: {
          ...mockOrder,
          nfses: [{ id: 'nfse-presa', status: NfseStatus.PROCESSING }],
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

      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        id: 'nfse-presa',
        status: NfseStatus.PROCESSING,
        rpsNumero: 7,
        rpsSerie: 'A1',
        ambiente: 2,
      });
      invoicyApiService.consultNfse.mockRejectedValue(new Error('timeout'));

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Teste',
        }),
      ).rejects.toThrow(ConflictException);

      expect(invoicyApiService.emitNfse).not.toHaveBeenCalled();
    });

    /**
     * O provedor recusa o lote antes de mandar para a prefeitura devolvendo um
     * Codigo diferente de 100 — resultado conhecido. Enquanto isso virava Error
     * puro, o classificador do catch não achava `error.response` e tratava como
     * transporte: a nota ficava PROCESSING travando a ordem e a tela dizia
     * "Falha de comunicação", escondendo o motivo acionável (série A1).
     */
    it('recusa do provedor (Codigo != 100) vira REJECTED com o motivo real', async () => {
      mockInvoicyApiService.emitNfse.mockResolvedValueOnce([
        {
          Codigo: 357,
          Descricao:
            '[#inv0357] - O valor informado no campo série é incorreto. A série deve conter apenas números.',
          Documentos: [],
        },
      ]);

      await expect(
        service.emitFromOrder(mockCompanyId, {
          orderId: mockOrderId,
          codigoServico: '1.05',
          discriminacao: 'Serviço de consultoria em TI',
        }),
      ).rejects.toThrow(/série deve conter apenas números/);

      expect(prisma.nfse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NfseStatus.REJECTED }),
        }),
      );
      expect(prisma.nfse.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NfseStatus.PROCESSING }),
        }),
      );
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

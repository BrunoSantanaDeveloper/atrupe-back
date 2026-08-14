import { Test, TestingModule } from '@nestjs/testing';
import { InvoicyApiService } from './invoicy-api.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { PrismaService } from 'nestjs-prisma';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { INVOICY_SUCCESS_CODES } from './invoicy.types';

/**
 * Chave real de uma NF-e da Plottec (homologação). Os eventos derivam dela o
 * CNPJ (posições 7-20), o modelo (21-22), a série (23-25) e o número (26-34),
 * então os testes de payload precisam de uma chave válida, não de um literal.
 */
const CHAVE_NFE = '32260749464815000110550010000000101000004900';

describe('InvoicyApiService', () => {
  let service: InvoicyApiService;
  let httpServiceMock: jest.Mocked<InvoicyHttpService>;
  let prismaMock: any;

  beforeEach(async () => {
    httpServiceMock = {
      makeRequest: jest.fn(),
      getCompanyCredentials: jest.fn(),
      authenticate: jest.fn(),
    } as any;

    prismaMock = {
      invoicyConfig: {
        findFirst: jest.fn(),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ address: [{ state: 'ES' }] }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicyApiService,
        { provide: InvoicyHttpService, useValue: httpServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: FiscalCredentialResolverService,
          useValue: {
            resolveOperationalEnvironment: jest
              .fn()
              .mockResolvedValue('HOMOLOGACAO'),
          },
        },
      ],
    }).compile();

    service = module.get<InvoicyApiService>(InvoicyApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('1. Emissão de NFe/NFCe (emitNfe)', () => {
    it('deve orquestrar a chamada POST corretamente para emissão', async () => {
      const documents: any[] = [{ Documento: { ModeloDocumento: 'NFe' } }];
      const expectedResponse = [
        { Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED },
      ];

      httpServiceMock.makeRequest.mockResolvedValueOnce(expectedResponse);

      const result = await service.emitNfe('company-123', documents);

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Emissao',
        documents,
        undefined,
        undefined,
        undefined,
        // disableRetry: emissão não é idempotente. Reenviar após um timeout
        // transmitiria de novo um documento que a SEFAZ pode já ter processado.
        true,
      );
      expect(result).toEqual(expectedResponse);
    });

    // O ambiente do payload tem de chegar ao transporte: é ele que escolhe o
    // host e a credencial. Sem isso o transporte resolve por conta própria e
    // pode divergir do tpAmb gravado no documento.
    it('deve repassar o ambiente forçado para o transporte', async () => {
      const documents: any[] = [{ Documento: { ModeloDocumento: 'NFe' } }];
      httpServiceMock.makeRequest.mockResolvedValueOnce([
        { Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED },
      ]);

      await service.emitNfe(
        'company-123',
        documents,
        'config-1',
        'PRODUCAO' as any,
      );

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Emissao',
        documents,
        'config-1',
        undefined,
        'PRODUCAO',
        true,
      );
    });

    it('deve repassar invoicyConfigId quando informado', async () => {
      const documents: any[] = [{ Documento: { ModeloDocumento: 'NFCe' } }];
      const expectedResponse = [
        { Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED },
      ];

      httpServiceMock.makeRequest.mockResolvedValueOnce(expectedResponse);

      await service.emitNfe('company-123', documents, 'config-123');

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Emissao',
        documents,
        'config-123',
        undefined,
        undefined,
        true,
      );
    });
  });

  describe('2. Cancelamento de NFe (cancelNfe)', () => {
    it('deve montar o evento de cancelamento (110111) na forma do provedor', async () => {
      httpServiceMock.makeRequest.mockResolvedValueOnce([{ Codigo: 100 }]);

      await service.cancelNfe('company-123', CHAVE_NFE, 'Cliente desistiu', 2);

      const expectedPayload = [
        {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Evento: {
            NtfCnpjEmissor: '49464815000110',
            NtfNumero: 10,
            NtfSerie: '1',
            tpAmb: 2,
            EveInf: {
              EveDh: expect.stringMatching(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
              ),
              EveFusoHorario: '-03:00',
              EveTp: 110111,
              EvenSeq: '1',
              Evedet: {
                EveDesc: 'Cancelamento',
                EvexJust: 'Cliente desistiu',
              },
            },
          },
        },
      ];

      // Eventos fiscais nao sao idempotentes: seguem com AbortSignal proprio e
      // com o retry desligado (ultimo argumento), para nunca reenviar um evento
      // que a SEFAZ ja' possa ter registrado.
      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Evento',
        expectedPayload,
        undefined,
        expect.any(AbortSignal),
        'HOMOLOGACAO',
        true,
      );
    });
  });

  describe('3. Carta de Correção (sendCorrectionLetter)', () => {
    it('deve montar o evento de CC-e (110110) na forma do provedor', async () => {
      httpServiceMock.makeRequest.mockResolvedValueOnce([{ Codigo: 100 }]);

      await service.sendCorrectionLetter(
        'company-123',
        CHAVE_NFE,
        'Ajuste de CFOP',
        2,
        2,
      );

      const expectedPayload = [
        {
          ModeloDocumento: 'NFe',
          Versao: 4,
          Evento: {
            NtfCnpjEmissor: '49464815000110',
            NtfNumero: 10,
            NtfSerie: '1',
            tpAmb: 2,
            EveInf: {
              EveDh: expect.stringMatching(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
              ),
              EveFusoHorario: '-03:00',
              EveTp: 110110,
              EvenSeq: '2',
              Evedet: {
                EveDesc: 'Carta de Correcao',
                EveCorrecao: 'Ajuste de CFOP',
                EveCondUso: expect.stringContaining(
                  'A Carta de Correcao e disciplinada',
                ),
              },
            },
          },
        },
      ];

      // Eventos fiscais nao sao idempotentes: seguem com AbortSignal proprio e
      // com o retry desligado (ultimo argumento), para nunca reenviar um evento
      // que a SEFAZ ja' possa ter registrado.
      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Evento',
        expectedPayload,
        undefined,
        expect.any(AbortSignal),
        'HOMOLOGACAO',
        true,
      );
    });
  });

  describe('4. Inutilização de Faixa de Numeração (inutilizarNfce)', () => {
    it('deve limpar o CNPJ e montar o payload de Inutilização', async () => {
      httpServiceMock.getCompanyCredentials.mockResolvedValueOnce({
        cnpj: '11.222.333/0001-44',
      } as any);

      prismaMock.invoicyConfig.findFirst.mockResolvedValueOnce({
        id: 'config-123',
        ambiente: 1, // Produção
      });

      // Override default mock to return PRODUCAO for this test
      const resolverMock = (service as any).fiscalCredentialResolver;
      resolverMock.resolveOperationalEnvironment.mockResolvedValueOnce(
        'PRODUCAO',
      );

      httpServiceMock.makeRequest.mockResolvedValueOnce([{ Codigo: 100 }]);

      await service.inutilizarNfce(
        'company-123',
        1,
        10,
        20,
        'Salto de numeração',
      );

      const expectedPayload = [
        {
          ModeloDocumento: 'NFCe',
          Versao: 4,
          CnpjEmissor: '11222333000144', // Garantir que só fiquem números
          tpAmb: 1,
          UfEmissor: 32, // ES
          NumeroInicial: 10,
          NumeroFinal: 20,
          Serie: '1',
          Justificativa: 'Salto de numeração',
        },
      ];

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Inutilizacao',
        expectedPayload,
        'config-123',
      );
    });
  });

  describe('5. Health Check SEFAZ (checkSefazStatus)', () => {
    it('deve retornar available: true se o código de resposta for 107 (Serviço em operação)', async () => {
      httpServiceMock.makeRequest.mockResolvedValueOnce([
        { Codigo: 107, Descricao: 'Serviço em operação' },
      ]);

      const result = await service.checkSefazStatus('company-123');

      expect(result).toEqual({
        available: true,
        message: 'Serviço em operação',
      });
    });

    it('deve retornar available: false e interceptar o erro se a requisição falhar', async () => {
      httpServiceMock.makeRequest.mockRejectedValueOnce(
        new Error('Invoicy Timeout'),
      );

      const result = await service.checkSefazStatus('company-123');

      expect(result).toEqual({ available: false, message: 'Invoicy Timeout' });
    });
  });
});

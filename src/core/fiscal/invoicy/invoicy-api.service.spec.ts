import { Test, TestingModule } from '@nestjs/testing';
import { InvoicyApiService } from './invoicy-api.service';
import { InvoicyHttpService } from './invoicy-http.service';
import { PrismaService } from 'nestjs-prisma';
import { FiscalCredentialResolverService } from '../shared/fiscal-credential-resolver.service';
import { INVOICY_SUCCESS_CODES } from './invoicy.types';

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
      );
      expect(result).toEqual(expectedResponse);
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
      );
    });
  });

  describe('2. Cancelamento de NFe (cancelNfe)', () => {
    it('deve montar o payload XML de Evento de Cancelamento (110111)', async () => {
      httpServiceMock.makeRequest.mockResolvedValueOnce([{ Codigo: 100 }]);

      await service.cancelNfe(
        'company-123',
        'CHAVE1234567890',
        'Cliente desistiu',
      );

      const expectedPayload = [
        {
          Documento: {
            ModeloDocumento: 'NFe',
            Versao: 4,
            Evento: {
              ChaveNFe: 'CHAVE1234567890',
              TipoEvento: 110111,
              nSeqEvento: 1,
              Justificativa: 'Cliente desistiu',
            },
          },
        },
      ];

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Evento',
        expectedPayload,
      );
    });
  });

  describe('3. Carta de Correção (sendCorrectionLetter)', () => {
    it('deve montar o payload XML de Carta de Correção (110110)', async () => {
      httpServiceMock.makeRequest.mockResolvedValueOnce([{ Codigo: 100 }]);

      await service.sendCorrectionLetter(
        'company-123',
        'CHAVE123',
        'Ajuste de CFOP',
        2,
      );

      const expectedPayload = [
        {
          Documento: {
            ModeloDocumento: 'NFe',
            Versao: 4,
            Evento: {
              ChaveNFe: 'CHAVE123',
              TipoEvento: 110110,
              nSeqEvento: 2,
              Correcao: 'Ajuste de CFOP',
            },
          },
        },
      ];

      expect(httpServiceMock.makeRequest).toHaveBeenCalledWith(
        'company-123',
        'POST',
        '/senddocuments/nfe?type=Evento',
        expectedPayload,
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

      const currentYear = new Date().getFullYear();

      await service.inutilizarNfce(
        'company-123',
        1,
        10,
        20,
        'Salto de numeração',
      );

      const expectedPayload = [
        {
          Documento: {
            ModeloDocumento: 'NFCe',
            Versao: 4,
            Inutilizacao: {
              Ano: currentYear,
              CNPJ: '11222333000144', // Garantir que só fiquem números
              Serie: 1,
              NumeroInicial: 10,
              NumeroFinal: 20,
              Justificativa: 'Salto de numeração',
              tpAmb: 1,
            },
          },
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

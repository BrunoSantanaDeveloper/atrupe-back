import { Test, TestingModule } from '@nestjs/testing';
import { NfeEventsService } from './nfe-events.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NfeStatus, NfeCorrectionStatus } from '@prisma/client';
import { INVOICY_SUCCESS_CODES } from '../invoicy/invoicy.types';

const CHAVE = '42260657968205000182550010000000101000005700';

describe('NfeEventsService', () => {
  let service: NfeEventsService;
  let prismaMock: any;
  let invoicyApiMock: any;
  /** Escritas efetivamente commitadas, para provar rollback nos testes. */
  let committed: { model: string; op: string; args: any }[];

  /**
   * Mock de $transaction com semântica real de rollback: as escritas feitas
   * dentro do callback só entram em `committed` se o callback resolver. Sem
   * isso, um refactor que remova a atomicidade passa despercebido.
   */
  function buildPrismaMock() {
    const staged: { model: string; op: string; args: any }[] = [];
    let inTransaction = false;

    const record = (model: string, op: string) =>
      jest.fn(async (args: any) => {
        const entry = { model, op, args };
        if (inTransaction) staged.push(entry);
        else committed.push(entry);
        return mockResults[`${model}.${op}`]?.(args) ?? {};
      });

    const mockResults: Record<string, (args: any) => any> = {};

    const client: any = {
      __mockResults: mockResults,
      nfe: {
        update: record('nfe', 'update'),
        updateMany: record('nfe', 'updateMany'),
        findUnique: jest.fn(async () => ({ status: NfeStatus.AUTHORIZED })),
      },
      nfeCorrectionEvent: {
        findFirst: jest.fn(async () => null),
        create: record('nfeCorrectionEvent', 'create'),
        update: record('nfeCorrectionEvent', 'update'),
      },
    };

    client.$transaction = jest.fn(async (callback: any) => {
      inTransaction = true;
      staged.length = 0;
      try {
        const result = await callback(client);
        committed.push(...staged);
        return result;
      } finally {
        staged.length = 0;
        inTransaction = false;
      }
    });

    return client;
  }

  const okResponse = (overrides: any = {}) => [
    {
      Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED,
      Documentos: [
        {
          Situacao: { SitCodigo: 135 },
          DocProtocolo: 'PROTOCOLO123',
          ...overrides,
        },
      ],
    },
  ];

  const authorizedNfe = (overrides: any = {}) => ({
    id: 'nfe-1',
    numero: 10,
    status: NfeStatus.AUTHORIZED,
    chaveAcesso: CHAVE,
    ambiente: 2,
    dataAutorizacao: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    committed = [];
    prismaMock = buildPrismaMock();

    invoicyApiMock = {
      cancelNfe: jest.fn(),
      sendCorrectionLetter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfeEventsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: InvoicyApiService, useValue: invoicyApiMock },
      ],
    }).compile();

    service = module.get<NfeEventsService>(NfeEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('cancel', () => {
    it('deve lançar erro se NFe não estiver autorizada', async () => {
      const nfe = { status: NfeStatus.DRAFT };
      await expect(
        service.cancel(nfe, 'company-1', {
          justificativa: 'Cancelamento por erro',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar erro se justificativa tiver menos de 15 caracteres', async () => {
      const nfe = { status: NfeStatus.AUTHORIZED };
      await expect(
        service.cancel(nfe, 'company-1', { justificativa: 'Curto' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar erro se passou do prazo de 24 horas', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 25);
      const nfe = { status: NfeStatus.AUTHORIZED, dataEmissao: pastDate };

      await expect(
        service.cancel(nfe, 'company-1', {
          justificativa: 'Cancelamento longo o suficiente',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve cancelar a NFe com sucesso e atualizar no banco de dados', async () => {
      const nfe = {
        id: 'nfe-1',
        status: NfeStatus.AUTHORIZED,
        dataEmissao: new Date(),
        chaveAcesso: 'CHAVE123',
        ambiente: 1,
      };

      invoicyApiMock.cancelNfe.mockResolvedValue(okResponse());
      prismaMock.__mockResults['nfe.update'] = () => ({
        ...nfe,
        status: NfeStatus.CANCELLED,
      });

      const result = await service.cancel(nfe, 'company-1', {
        justificativa: 'Cancelamento longo o suficiente',
      });

      expect(invoicyApiMock.cancelNfe).toHaveBeenCalledWith(
        'company-1',
        'CHAVE123',
        'Cancelamento longo o suficiente',
        1,
      );
      expect(result.status).toBe(NfeStatus.CANCELLED);
    });
  });

  describe('sendCorrectionLetter', () => {
    it('deve lançar erro se NFe não estiver autorizada', async () => {
      const nfe = { status: NfeStatus.DRAFT };
      await expect(
        service.sendCorrectionLetter(nfe, 'company-1', {
          correcao: 'Correção de CFOP para 6102',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar erro se texto de correção for muito curto', async () => {
      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Curto',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve rejeitar chave de acesso que não tenha 44 dígitos', async () => {
      await expect(
        service.sendCorrectionLetter(
          authorizedNfe({ chaveAcesso: '123' }),
          'company-1',
          { correcao: 'Correção de CFOP para 6102' },
        ),
      ).rejects.toThrow('44 dígitos');

      expect(invoicyApiMock.sendCorrectionLetter).not.toHaveBeenCalled();
    });

    it('deve recusar CC-e fora do prazo de 720 horas', async () => {
      const antiga = new Date();
      antiga.setDate(antiga.getDate() - 31);

      await expect(
        service.sendCorrectionLetter(
          authorizedNfe({ dataAutorizacao: antiga }),
          'company-1',
          { correcao: 'Correção de CFOP para 6102' },
        ),
      ).rejects.toThrow('720 horas');

      // Nenhuma sequência pode ser consumida por uma pré-condição.
      expect(prismaMock.nfeCorrectionEvent.create).not.toHaveBeenCalled();
      expect(invoicyApiMock.sendCorrectionLetter).not.toHaveBeenCalled();
    });

    it('deve enviar a carta de correção e confirmar o evento', async () => {
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue(
        okResponse({
          DocXMLBase64: Buffer.from('<evento/>').toString('base64'),
        }),
      );
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 1 });
      prismaMock.nfe.findUnique.mockResolvedValue({
        id: 'nfe-1',
        status: NfeStatus.CORRECTION_SENT,
      });
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });

      const result = await service.sendCorrectionLetter(
        authorizedNfe(),
        'company-1',
        { correcao: 'Correção de CFOP para 6102' },
        { userId: 'user-1', name: 'Maria' },
      );

      expect(invoicyApiMock.sendCorrectionLetter).toHaveBeenCalledWith(
        'company-1',
        CHAVE,
        'Correção de CFOP para 6102',
        1,
        2,
      );

      // Reserva em PENDING antes do POST, com autoria.
      expect(prismaMock.nfeCorrectionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nfeId: 'nfe-1',
            sequenciaEvento: 1,
            status: NfeCorrectionStatus.PENDING,
            ambiente: 2,
            createdBy: 'user-1',
            createdByName: 'Maria',
          }),
        }),
      );

      // Confirmação com XML decodificado.
      expect(prismaMock.nfeCorrectionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({
            status: NfeCorrectionStatus.REGISTERED,
            protocolo: 'PROTOCOLO123',
            xmlEvento: '<evento/>',
            sitCodigo: 135,
          }),
        }),
      );

      expect(result.status).toBe(NfeStatus.CORRECTION_SENT);
    });

    it('deve calcular a próxima sequência a partir do histórico', async () => {
      prismaMock.nfeCorrectionEvent.findFirst.mockImplementation(
        async (args: any) =>
          args?.where?.status === NfeCorrectionStatus.PENDING
            ? null
            : { sequenciaEvento: 3 },
      );
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-4',
        sequenciaEvento: 4,
      });
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 1 });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue(okResponse());

      await service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
        correcao: 'Correção da descrição do produto',
      });

      expect(invoicyApiMock.sendCorrectionLetter).toHaveBeenCalledWith(
        'company-1',
        CHAVE,
        'Correção da descrição do produto',
        4,
        2,
      );
    });

    it('deve barrar a 21ª carta de correção', async () => {
      prismaMock.nfeCorrectionEvent.findFirst.mockImplementation(
        async (args: any) =>
          args?.where?.status === NfeCorrectionStatus.PENDING
            ? null
            : { sequenciaEvento: 20 },
      );

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow('20 cartas de correção');

      expect(invoicyApiMock.sendCorrectionLetter).not.toHaveBeenCalled();
    });

    it('deve bloquear quando já existe uma CC-e em processamento', async () => {
      prismaMock.nfeCorrectionEvent.findFirst.mockImplementation(
        async (args: any) =>
          args?.where?.status === NfeCorrectionStatus.PENDING
            ? { id: 'evt-pendente', sequenciaEvento: 2 }
            : { sequenciaEvento: 2 },
      );

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow(ConflictException);

      expect(invoicyApiMock.sendCorrectionLetter).not.toHaveBeenCalled();
    });

    it('deve abortar se o status da NF-e mudar dentro da transação', async () => {
      prismaMock.nfe.findUnique.mockResolvedValue({
        status: NfeStatus.CANCELLED,
      });

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow(ConflictException);

      // A reserva foi feita dentro da transação que falhou: não pode ter sido
      // commitada.
      expect(committed.some((c) => c.model === 'nfeCorrectionEvent')).toBe(
        false,
      );
    });

    it('deve resolver o ambiente pelo tpAmb do XML autorizado', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 1 });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue(okResponse());

      // Banco diz homologação (2); o XML autorizado diz produção (1).
      await service.sendCorrectionLetter(
        authorizedNfe({
          ambiente: 2,
          xmlAutorizado: '<NFe><ide><tpAmb>1</tpAmb></ide></NFe>',
        }),
        'company-1',
        { correcao: 'Correção da descrição do produto' },
      );

      expect(invoicyApiMock.sendCorrectionLetter).toHaveBeenCalledWith(
        'company-1',
        CHAVE,
        'Correção da descrição do produto',
        1,
        1,
      );
    });

    it('deve aceitar SitCodigo 136 (registrado sem vínculo) como sucesso', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 1 });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED,
          Documentos: [
            { Situacao: { SitCodigo: 136 }, DocProtocolo: 'PROTOCOLO136' },
          ],
        },
      ]);

      await service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
        correcao: 'Correção da descrição do produto',
      });

      expect(prismaMock.nfeCorrectionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NfeCorrectionStatus.REGISTERED,
            sitCodigo: 136,
          }),
        }),
      );
    });

    it('deve persistir a rejeição da SEFAZ em vez de sumir com a tentativa', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: 400,
          Descricao:
            'Não foi possível processar a operação, verifique os dados enviados e tente novamente.',
          ErrorInvoicy: 'O campo Correcao contém caracteres inválidos',
        },
      ]);

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow(
        'Carta de correção rejeitada (código 400): O campo Correcao contém caracteres inválidos',
      );

      expect(prismaMock.nfeCorrectionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({
            status: NfeCorrectionStatus.REJECTED,
            codigoRetorno: 400,
          }),
        }),
      );
    });

    it('deve devolver 503 e registrar a tentativa quando o provedor falha', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      invoicyApiMock.sendCorrectionLetter.mockRejectedValue(
        new Error('timeout of 45000ms exceeded'),
      );

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(prismaMock.nfeCorrectionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NfeCorrectionStatus.REJECTED,
            motivoRejeicao: expect.stringContaining('timeout'),
          }),
        }),
      );
    });

    it('deve preservar o status quando a NF-e sai de estado corrigível durante o evento', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      // O update condicional não encontra a nota em AUTHORIZED/CORRECTION_SENT.
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 0 });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue(okResponse());
      // Na reserva a nota ainda estava corrigível; o cancelamento é confirmado
      // enquanto o evento está em voo.
      prismaMock.nfe.findUnique
        .mockResolvedValueOnce({ status: NfeStatus.AUTHORIZED })
        .mockResolvedValue({ id: 'nfe-1', status: NfeStatus.CANCELLED });

      const result = await service.sendCorrectionLetter(
        authorizedNfe(),
        'company-1',
        { correcao: 'Correção da descrição do produto' },
      );

      // O evento é gravado (existe na SEFAZ), mas o cancelamento não é apagado.
      expect(prismaMock.nfeCorrectionEvent.update).toHaveBeenCalled();
      expect(result.status).toBe(NfeStatus.CANCELLED);
    });

    it('deve sanitizar quebras de linha e caracteres de controle antes de enviar', async () => {
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      prismaMock.__mockResults['nfe.updateMany'] = () => ({ count: 1 });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue(okResponse());

      await service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
        correcao: '  Correção da\r\ndescrição\tdo produto  ',
      });

      expect(invoicyApiMock.sendCorrectionLetter).toHaveBeenCalledWith(
        'company-1',
        CHAVE,
        'Correção da descrição do produto',
        1,
        2,
      );
    });

    it('deve explicar os dados enviados quando o Invoicy retorna apenas erro genérico', async () => {
      const correcao = 'Correção da descrição do produto';
      prismaMock.__mockResults['nfeCorrectionEvent.create'] = () => ({
        id: 'evt-1',
        sequenciaEvento: 1,
      });
      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: 400,
          Descricao:
            'Não foi possível processar a operação, verifique os dados enviados e tente novamente.',
        },
      ]);

      await expect(
        service.sendCorrectionLetter(authorizedNfe(), 'company-1', {
          correcao,
        }),
      ).rejects.toThrow(
        `Dados enviados: chave de acesso ${CHAVE} (44 dígitos), sequência 1 e texto da correção com ${correcao.length} caracteres.`,
      );
    });
  });
});

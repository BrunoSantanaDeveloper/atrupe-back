import { Test, TestingModule } from '@nestjs/testing';
import { NfeEventsService } from './nfe-events.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyApiService } from '../invoicy/invoicy-api.service';
import { BadRequestException } from '@nestjs/common';
import { NfeStatus } from '@prisma/client';
import { INVOICY_SUCCESS_CODES } from '../invoicy/invoicy.types';

describe('NfeEventsService', () => {
  let service: NfeEventsService;
  let prismaMock: any;
  let invoicyApiMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn(async (callback) => callback(prismaMock)),
      nfe: {
        update: jest.fn(),
      },
      nfeCorrectionEvent: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

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

      invoicyApiMock.cancelNfe.mockResolvedValue([
        {
          Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED,
          Documentos: [
            { Situacao: { SitCodigo: 135 }, DocProtocolo: 'PROTOCOLO123' },
          ],
        },
      ]);

      prismaMock.nfe.update.mockResolvedValue({
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
      expect(prismaMock.nfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nfe-1' },
          data: expect.objectContaining({
            status: NfeStatus.CANCELLED,
            protocoloCancelamento: 'PROTOCOLO123',
          }),
        }),
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
      const nfe = { status: NfeStatus.AUTHORIZED };
      await expect(
        service.sendCorrectionLetter(nfe, 'company-1', { correcao: 'Curto' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve enviar a carta de correção e atualizar o banco de dados', async () => {
      const chaveAcesso = '42260657968205000182550010000000101000005700';
      const nfe = {
        id: 'nfe-1',
        status: NfeStatus.AUTHORIZED,
        chaveAcesso,
        ambiente: 2,
      };

      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: INVOICY_SUCCESS_CODES.DOCUMENTS_PROCESSED,
          Documentos: [
            { Situacao: { SitCodigo: 135 }, DocProtocolo: 'PROTOCOLO123' },
          ],
        },
      ]);

      prismaMock.nfe.update.mockResolvedValue({
        ...nfe,
        status: NfeStatus.CORRECTION_SENT,
      });

      const result = await service.sendCorrectionLetter(nfe, 'company-1', {
        correcao: 'Correção de CFOP para 6102',
        sequenciaEvento: 1,
      });

      expect(invoicyApiMock.sendCorrectionLetter).toHaveBeenCalledWith(
        'company-1',
        chaveAcesso,
        'Correção de CFOP para 6102',
        1,
        2,
      );
      expect(prismaMock.nfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nfe-1' },
          data: expect.objectContaining({
            status: NfeStatus.CORRECTION_SENT,
            protocoloCorrecao: 'PROTOCOLO123',
          }),
        }),
      );
      expect(prismaMock.nfeCorrectionEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nfeId: 'nfe-1',
            sequenciaEvento: 1,
            correcao: 'Correção de CFOP para 6102',
            protocolo: 'PROTOCOLO123',
          }),
        }),
      );
      expect(result.status).toBe(NfeStatus.CORRECTION_SENT);
    });

    it('deve informar o detalhe retornado pelo Invoicy', async () => {
      const nfe = {
        id: 'nfe-1',
        numero: 10,
        status: NfeStatus.AUTHORIZED,
        chaveAcesso: '42260657968205000182550010000000101000005700',
      };

      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: 400,
          Descricao:
            'Não foi possível processar a operação, verifique os dados enviados e tente novamente.',
          ErrorInvoicy: 'O campo Correcao contém caracteres inválidos',
        },
      ]);

      await expect(
        service.sendCorrectionLetter(nfe, 'company-1', {
          correcao: 'Correção da descrição do produto',
        }),
      ).rejects.toThrow(
        'Carta de correção rejeitada (código 400): O campo Correcao contém caracteres inválidos',
      );
    });

    it('deve explicar os dados enviados quando o Invoicy retorna apenas erro genérico', async () => {
      const chaveAcesso = '42260657968205000182550010000000101000005700';
      const correcao = 'Correção da descrição do produto';
      const nfe = {
        id: 'nfe-1',
        numero: 10,
        status: NfeStatus.AUTHORIZED,
        chaveAcesso,
      };

      invoicyApiMock.sendCorrectionLetter.mockResolvedValue([
        {
          Codigo: 400,
          Descricao:
            'Não foi possível processar a operação, verifique os dados enviados e tente novamente.',
        },
      ]);

      await expect(
        service.sendCorrectionLetter(nfe, 'company-1', { correcao }),
      ).rejects.toThrow(
        `Dados enviados: chave de acesso ${chaveAcesso} (44 dígitos), sequência 1 e texto da correção com ${correcao.length} caracteres.`,
      );
    });
  });
});

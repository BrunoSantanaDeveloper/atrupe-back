import { Test, TestingModule } from '@nestjs/testing';
import { NfeDraftService } from './nfe-draft.service';
import { PrismaService } from 'nestjs-prisma';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NfeStatus } from '@prisma/client';

describe('NfeDraftService', () => {
  let service: NfeDraftService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      nfe: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfeDraftService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<NfeDraftService>(NfeDraftService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findDraftByOrderId', () => {
    it('deve retornar o rascunho se existir', async () => {
      const mockDraft = {
        id: 'draft-1',
        orderId: 'order-1',
        status: NfeStatus.DRAFT,
      };
      prismaMock.nfe.findFirst.mockResolvedValue(mockDraft);

      const result = await service.findDraftByOrderId('company-1', 'order-1');

      expect(prismaMock.nfe.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          orderId: 'order-1',
          status: NfeStatus.DRAFT,
        },
      });
      expect(result).toEqual(mockDraft);
    });
  });

  describe('mergeDraftWithPreparedData', () => {
    it('deve mesclar dados preparados com dados do rascunho priorizando rascunho', () => {
      const draft = {
        id: 'draft-1',
        draftData: {
          destinatario: { nome: 'Nome do Rascunho' },
          items: [{ productId: 'P1', quantity: 10 }],
        },
      };

      const preparedData = {
        destinatario: { nome: 'Nome Preparado' },
        items: [{ productId: 'P1', quantity: 5, isService: true }],
        transportadora: { nome: 'Transp 1' },
      };

      const result = service.mergeDraftWithPreparedData(draft, preparedData);

      expect(result.draftId).toBe('draft-1');
      expect(result.isDraft).toBe(true);
      expect(result.destinatario.nome).toBe('Nome do Rascunho'); // Prioridade rascunho
      expect(result.items[0].quantity).toBe(10); // Prioridade rascunho
      expect(result.items[0].isService).toBe(true); // Mantido do prepared
      expect(result.transportadora.nome).toBe('Transp 1'); // Mantido do prepared
    });
  });

  describe('createDraft', () => {
    it('deve criar um rascunho com os dados fornecidos', async () => {
      const config = { proximoNumeroNfe: 100, serieNfe: 2, ambiente: 1 };
      const preparedData = {
        totais: { valorNota: 500 },
        destinatario: { nome: 'Teste' },
      };

      prismaMock.nfe.create.mockResolvedValue({ id: 'draft-new' });

      const result = await service.createDraft(
        'company-1',
        'order-1',
        'quote-1',
        preparedData,
        config,
      );

      expect(prismaMock.nfe.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            orderId: 'order-1',
            numero: 100,
            serie: 2,
            status: NfeStatus.DRAFT,
            ambiente: 1,
            valorTotal: 500,
          }),
        }),
      );
      expect(result.draftId).toBe('draft-new');
    });

    it('deve lançar erro se config não for fornecido', async () => {
      await expect(
        service.createDraft('company-1', 'order-1', 'quote-1', {}, null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateDraft', () => {
    it('deve atualizar os dados do rascunho', async () => {
      prismaMock.nfe.findFirst.mockResolvedValue({
        id: 'draft-1',
        draftData: { destinatario: { nome: 'Antigo' } },
      });

      prismaMock.nfe.update.mockResolvedValue({ id: 'draft-1' });

      const updateDto: any = { destinatario: { nome: 'Novo' } };
      const result = await service.updateDraft(
        'company-1',
        'draft-1',
        updateDto,
      );

      expect(prismaMock.nfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'draft-1' },
          data: expect.objectContaining({
            draftData: expect.objectContaining({
              destinatario: { nome: 'Novo' },
            }),
          }),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('deve lançar erro se rascunho não for encontrado', async () => {
      prismaMock.nfe.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDraft('company-1', 'draft-invalid', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteDraft', () => {
    it('deve deletar o rascunho', async () => {
      prismaMock.nfe.findFirst.mockResolvedValue({ id: 'draft-1' });
      prismaMock.nfe.delete.mockResolvedValue({ id: 'draft-1' });

      const result = await service.deleteDraft('company-1', 'draft-1');

      expect(prismaMock.nfe.delete).toHaveBeenCalledWith({
        where: { id: 'draft-1' },
      });
      expect(result.success).toBe(true);
    });

    it('deve lançar erro se tentar deletar rascunho inexistente', async () => {
      prismaMock.nfe.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteDraft('company-1', 'draft-invalid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { NfseDraftService } from './nfse-draft.service';
import { PrismaService } from 'nestjs-prisma';
import { NfseStatus } from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('NfseDraftService', () => {
  let service: NfseDraftService;
  let prisma: PrismaService;

  const mockPrisma = {
    nfse: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfseDraftService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NfseDraftService>(NfseDraftService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findDraftByOrderId', () => {
    it('should return draft when found', async () => {
      const mockDraft = {
        id: 'draft-1',
        orderId: 'order-1',
        status: NfseStatus.DRAFT,
      };
      mockPrisma.nfse.findFirst.mockResolvedValue(mockDraft);

      const result = await service.findDraftByOrderId('company-1', 'order-1');

      expect(result).toEqual(mockDraft);
      expect(mockPrisma.nfse.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          orderId: 'order-1',
          status: NfseStatus.DRAFT,
        },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.nfse.findFirst.mockResolvedValue(null);

      const result = await service.findDraftByOrderId('company-1', 'order-1');

      expect(result).toBeNull();
    });
  });

  describe('findDraftById', () => {
    it('should return draft when found', async () => {
      const mockDraft = { id: 'draft-1', status: NfseStatus.DRAFT };
      mockPrisma.nfse.findFirst.mockResolvedValue(mockDraft);

      const result = await service.findDraftById('company-1', 'draft-1');

      expect(result).toEqual(mockDraft);
    });
  });

  describe('createDraft', () => {
    const mockConfig = {
      proximoRpsNfse: 1,
      serieNfse: 'A1',
      ambiente: 2,
      aliquotaIss: 5,
    };

    it('should create draft successfully', async () => {
      const dto = {
        orderId: 'order-1',
        tomador: { razaoSocial: 'Cliente Teste' },
        codigoServico: '0201',
        discriminacao: 'Serviço de teste',
        valorServicos: 1000,
        aliquotaIss: 5,
      };

      mockPrisma.nfse.findFirst.mockResolvedValue(null);
      mockPrisma.nfse.create.mockResolvedValue({
        id: 'draft-1',
        orderId: 'order-1',
        status: NfseStatus.DRAFT,
      });

      const result = await service.createDraft('company-1', dto, mockConfig);

      expect(result.draftId).toBe('draft-1');
      expect(result.isDraft).toBe(true);
      expect(mockPrisma.nfse.create).toHaveBeenCalled();
    });

    it('should return existing draft if already exists', async () => {
      const existingDraft = {
        id: 'existing-draft',
        orderId: 'order-1',
        status: NfseStatus.DRAFT,
        draftData: { tomador: { razaoSocial: 'Existing' } },
      };
      mockPrisma.nfse.findFirst.mockResolvedValue(existingDraft);

      const dto = {
        orderId: 'order-1',
        tomador: { razaoSocial: 'Novo' },
      };

      const result = await service.createDraft('company-1', dto, mockConfig);

      expect(result.draftId).toBe('existing-draft');
      expect(mockPrisma.nfse.create).not.toHaveBeenCalled();
    });

    it('should throw if config is missing', async () => {
      await expect(
        service.createDraft('company-1', { orderId: 'order-1' }, null),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateDraft', () => {
    it('should update draft successfully', async () => {
      const existingDraft = {
        id: 'draft-1',
        draftData: { tomador: { razaoSocial: 'Old' } },
      };
      mockPrisma.nfse.findFirst.mockResolvedValue(existingDraft);
      mockPrisma.nfse.update.mockResolvedValue({ id: 'draft-1' });

      const result = await service.updateDraft('company-1', 'draft-1', {
        tomador: { razaoSocial: 'Updated' },
        valorServicos: 2000,
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.nfse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'draft-1' },
        }),
      );
    });

    it('should throw if draft not found', async () => {
      mockPrisma.nfse.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDraft('company-1', 'draft-1', { valorServicos: 2000 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteDraft', () => {
    it('should delete draft successfully', async () => {
      mockPrisma.nfse.findFirst.mockResolvedValue({ id: 'draft-1' });
      mockPrisma.nfse.delete.mockResolvedValue({ id: 'draft-1' });

      const result = await service.deleteDraft('company-1', 'draft-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.nfse.delete).toHaveBeenCalledWith({
        where: { id: 'draft-1' },
      });
    });

    it('should throw if draft not found', async () => {
      mockPrisma.nfse.findFirst.mockResolvedValue(null);

      await expect(service.deleteDraft('company-1', 'draft-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listDrafts', () => {
    it('should list all drafts for company', async () => {
      const drafts = [
        { id: 'draft-1', status: NfseStatus.DRAFT },
        { id: 'draft-2', status: NfseStatus.DRAFT },
      ];
      mockPrisma.nfse.findMany.mockResolvedValue(drafts);

      const result = await service.listDrafts('company-1');

      expect(result).toEqual(drafts);
      expect(mockPrisma.nfse.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          status: NfseStatus.DRAFT,
        },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });
  });

  describe('mergeDraftWithPreparedData', () => {
    it('should merge draft data correctly', () => {
      const draft = {
        id: 'draft-1',
        draftData: {
          tomador: { razaoSocial: 'Draft Tomador' },
          valorServicos: 1500,
        },
      };

      const preparedData = {
        tomador: { razaoSocial: 'Prepared Tomador' },
        valorServicos: 1000,
        codigoServico: '0201',
      };

      const result = service.mergeDraftWithPreparedData(draft, preparedData);

      expect(result.draftId).toBe('draft-1');
      expect(result.isDraft).toBe(true);
      // Draft data should override prepared data
      expect(result.tomador.razaoSocial).toBe('Draft Tomador');
      expect(result.valorServicos).toBe(1500);
      // Prepared data fields not in draft should remain
      expect(result.codigoServico).toBe('0201');
    });
  });
});

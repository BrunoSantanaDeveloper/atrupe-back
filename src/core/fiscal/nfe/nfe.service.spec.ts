import { Test, TestingModule } from '@nestjs/testing';
import { NfeService } from './nfe.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NfeStatus } from '@prisma/client';

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

const mockInvoicyResponse = {
  success: true,
  data: {
    chaveAcesso: '35260212345678000123550010000000011123456789',
    protocolo: '123456789012345',
    status: 'AUTORIZADO',
  },
};

// Mock implementations
const mockPrismaService = {
  order: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
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
  invoicyConfig: {
    findFirst: jest.fn(),
  },
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  incrementNfeNumber: jest.fn(),
};

const mockInvoicyHttpService = {
  emitNfe: jest.fn(),
  cancelNfe: jest.fn(),
  getStatusNfe: jest.fn(),
  sendCorrectionLetter: jest.fn(),
};

describe('NfeService', () => {
  let service: NfeService;
  let prisma: typeof mockPrismaService;
  let invoicyService: typeof mockInvoicyService;
  let invoicyHttpService: typeof mockInvoicyHttpService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
      ],
    }).compile();

    service = module.get<NfeService>(NfeService);
    prisma = module.get(PrismaService);
    invoicyService = module.get(InvoicyService);
    invoicyHttpService = module.get(InvoicyHttpService);
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

      expect(result.data).toEqual(mockNfes);
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

  describe('findById', () => {
    it('should return NFe when found', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);

      const result = await service.findById(mockNfeId, mockCompanyId);

      expect(result).toEqual(mockNfe);
      expect(prisma.nfe.findFirst).toHaveBeenCalledWith({
        where: { id: mockNfeId, companyId: mockCompanyId },
      });
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
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
    });

    it('should prepare NFe data from order', async () => {
      const result = await service.prepareFromOrder(mockCompanyId, mockOrderId);

      expect(result).toBeDefined();
      expect(result.orderId).toBe(mockOrderId);
      expect(result.items).toHaveLength(1);
      expect(prisma.order.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockOrderId },
        }),
      );
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

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
  });

  describe('createOrGetDraft', () => {
    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
      });
    });

    it('should return existing draft if exists', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);

      const result = await service.createOrGetDraft(mockCompanyId, mockOrderId);

      expect(result.id).toBe(mockNfeId);
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

      await service.deleteDraft(mockNfeId, mockCompanyId);

      expect(prisma.nfe.delete).toHaveBeenCalledWith({
        where: { id: mockNfeId },
      });
    });

    it('should throw if NFe is not a draft', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...mockNfe,
        status: NfeStatus.AUTHORIZED,
      });

      await expect(
        service.deleteDraft(mockNfeId, mockCompanyId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('emit', () => {
    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      invoicyService.getDefaultConfig.mockResolvedValue({
        serieNfe: 1,
        proximoNumeroNfe: 1,
        ambiente: 2,
      });
      invoicyHttpService.emitNfe.mockResolvedValue(mockInvoicyResponse);
      prisma.nfe.update.mockResolvedValue({
        ...mockNfe,
        status: NfeStatus.AUTHORIZED,
        chaveAcesso: mockInvoicyResponse.data.chaveAcesso,
      });
    });

    it('should emit NFe successfully', async () => {
      const result = await service.emit(mockCompanyId, {
        orderId: mockOrderId,
      });

      expect(result.status).toBe(NfeStatus.AUTHORIZED);
      expect(result.chaveAcesso).toBeDefined();
      expect(invoicyHttpService.emitNfe).toHaveBeenCalled();
      expect(invoicyService.incrementNfeNumber).toHaveBeenCalled();
    });

    it('should update NFe to PROCESSING during emission', async () => {
      await service.emit(mockCompanyId, { orderId: mockOrderId });

      expect(prisma.nfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NfeStatus.PROCESSING,
          }),
        }),
      );
    });

    it('should handle Invoicy failure', async () => {
      invoicyHttpService.emitNfe.mockResolvedValue({
        success: false,
        error: 'Falha na comunicação',
      });

      await expect(
        service.emit(mockCompanyId, { orderId: mockOrderId }),
      ).rejects.toThrow();
    });
  });

  describe('cancel', () => {
    const authorizedNfe = {
      ...mockNfe,
      status: NfeStatus.AUTHORIZED,
      chaveAcesso: '35260212345678000123550010000000011123456789',
    };

    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue(authorizedNfe);
      invoicyHttpService.cancelNfe.mockResolvedValue({ success: true });
      prisma.nfe.update.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CANCELLED,
      });
    });

    it('should cancel authorized NFe', async () => {
      const result = await service.cancel(mockNfeId, mockCompanyId, {
        justificativa: 'Cancelamento por erro de digitação',
      });

      expect(result.status).toBe(NfeStatus.CANCELLED);
      expect(invoicyHttpService.cancelNfe).toHaveBeenCalled();
    });

    it('should throw if NFe is not authorized', async () => {
      prisma.nfe.findFirst.mockResolvedValue(mockNfe); // DRAFT status

      await expect(
        service.cancel(mockNfeId, mockCompanyId, {
          justificativa: 'Teste cancelamento',
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
  });

  describe('sendCorrectionLetter', () => {
    const authorizedNfe = {
      ...mockNfe,
      status: NfeStatus.AUTHORIZED,
      chaveAcesso: '35260212345678000123550010000000011123456789',
    };

    beforeEach(() => {
      prisma.nfe.findFirst.mockResolvedValue(authorizedNfe);
      invoicyHttpService.sendCorrectionLetter.mockResolvedValue({
        success: true,
      });
      prisma.nfe.update.mockResolvedValue({
        ...authorizedNfe,
        status: NfeStatus.CORRECTION_SENT,
        cartaCorrecao: 'Correção de endereço do destinatário',
        sequenciaCorrecao: 1,
      });
    });

    it('should send correction letter', async () => {
      const result = await service.sendCorrectionLetter(
        mockNfeId,
        mockCompanyId,
        {
          correcao: 'Correção de endereço do destinatário para Rua Nova, 100',
        },
      );

      expect(result.status).toBe(NfeStatus.CORRECTION_SENT);
      expect(result.cartaCorrecao).toBeDefined();
    });

    it('should increment correction sequence', async () => {
      prisma.nfe.findFirst.mockResolvedValue({
        ...authorizedNfe,
        sequenciaCorrecao: 1,
      });

      await service.sendCorrectionLetter(mockNfeId, mockCompanyId, {
        correcao: 'Segunda correção de dados do fornecedor',
      });

      expect(prisma.nfe.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sequenciaCorrecao: 2,
          }),
        }),
      );
    });
  });
});

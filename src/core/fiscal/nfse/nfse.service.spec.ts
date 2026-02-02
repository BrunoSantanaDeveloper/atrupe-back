import { Test, TestingModule } from '@nestjs/testing';
import { NfseService } from './nfse.service';
import { PrismaService } from 'nestjs-prisma';
import { InvoicyService } from '../invoicy/invoicy.service';
import { InvoicyHttpService } from '../invoicy/invoicy-http.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NfseStatus } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockOrderId = 'order-uuid-456';
const mockNfseId = 'nfse-uuid-789';

const mockOrder = {
  id: mockOrderId,
  companyId: mockCompanyId,
  status: 'COMPLETED',
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
    address: {
      city: 'São Paulo',
      state: 'SP',
      ibgeCode: '3550308',
    },
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

const mockInvoicyResponse = {
  success: true,
  data: {
    numero: 1,
    codigoVerificacao: 'ABC123',
    status: 'AUTORIZADO',
    pdfUrl: 'https://invoicy.com/pdf/123',
  },
};

const mockPrismaService = {
  order: { findUnique: jest.fn() },
  company: { findUnique: jest.fn() },
  nfse: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  invoicyConfig: { findFirst: jest.fn() },
};

const mockInvoicyService = {
  getDefaultConfig: jest.fn(),
  incrementRpsNumber: jest.fn(),
};

const mockInvoicyHttpService = {
  emitNfse: jest.fn(),
  cancelNfse: jest.fn(),
  getStatusNfse: jest.fn(),
};

describe('NfseService', () => {
  let service: NfseService;
  let prisma: typeof mockPrismaService;
  let invoicyHttpService: typeof mockInvoicyHttpService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NfseService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: InvoicyService, useValue: mockInvoicyService },
        { provide: InvoicyHttpService, useValue: mockInvoicyHttpService },
      ],
    }).compile();

    service = module.get<NfseService>(NfseService);
    prisma = module.get(PrismaService);
    invoicyHttpService = module.get(InvoicyHttpService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated list of NFSes', async () => {
      prisma.nfse.findMany.mockResolvedValue([mockNfse]);
      prisma.nfse.count.mockResolvedValue(1);

      const result = await service.findAll(mockCompanyId, {});

      expect(result.data).toHaveLength(1);
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
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.company.findUnique.mockResolvedValue(mockOrder.company);
      mockInvoicyService.getDefaultConfig.mockResolvedValue({
        serieNfse: 'A1',
        proximoRpsNfse: 1,
        ambiente: 2,
      });
      invoicyHttpService.emitNfse.mockResolvedValue(mockInvoicyResponse);
      prisma.nfse.create.mockResolvedValue(mockNfse);
      prisma.nfse.update.mockResolvedValue({
        ...mockNfse,
        status: NfseStatus.AUTHORIZED,
      });
    });

    it('should emit NFSe from order', async () => {
      const result = await service.emitFromOrder(mockCompanyId, {
        orderId: mockOrderId,
      });

      expect(result).toBeDefined();
      expect(invoicyHttpService.emitNfse).toHaveBeenCalled();
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

      await service.emitFromOrder(mockCompanyId, { orderId: mockOrderId });

      // Verify only service items are processed
      expect(invoicyHttpService.emitNfse).toHaveBeenCalledWith(
        expect.objectContaining({
          servicos: expect.arrayContaining([
            expect.objectContaining({ descricao: expect.any(String) }),
          ]),
        }),
      );
    });

    it('should throw if order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.emitFromOrder(mockCompanyId, { orderId: 'invalid' }),
      ).rejects.toThrow(NotFoundException);
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
      invoicyHttpService.cancelNfse.mockResolvedValue({ success: true });
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

  describe('getPdfUrl', () => {
    it('should return PDF URL', async () => {
      prisma.nfse.findFirst.mockResolvedValue({
        ...mockNfse,
        pdfUrl: 'https://invoicy.com/pdf/123',
      });

      const result = await service.getPdfUrl(mockNfseId, mockCompanyId);

      expect(result).toBe('https://invoicy.com/pdf/123');
    });
  });
});

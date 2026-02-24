import { Test, TestingModule } from '@nestjs/testing';
import { QuotationService } from './quotation.service';
import { PrismaService } from 'nestjs-prisma';
import { OrderService } from '../order/order.service';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationImportService } from './quotation-import.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus, OrderStatus } from '@prisma/client';

// Mock data
const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';
const mockOrderId = 'order-uuid-789';
const mockClientId = 'client-uuid-101';
const mockUserId = 'user-uuid-202';
const mockDeliveryInfoId = 'delivery-info-uuid-303';

const mockClient = {
  id: mockClientId,
  name: 'Cliente Teste',
  status: 'ACTIVE',
  document: '12345678901',
};

const mockClientInactive = {
  ...mockClient,
  status: 'INACTIVE',
};

const mockDeliveryInfo = {
  id: mockDeliveryInfoId,
  estimatedDate: new Date(),
  daysAfterApproval: 7,
  cost: 0,
  supplierId: null,
  deliveryType: 'DELIVERY',
};

const mockQuotationPayment = {
  billing: 'ON_DELIVERY',
  quotationInstallment: [],
  commission: 0,
  downPayment: 0,
  downPaymentDueDate: null,
  downPaymentAdditionalFee: 0,
  description: null,
  downPaymentConditionId: null,
};

const mockSeries = {
  id: 'series-uuid-404',
  title: 'Série Padrão',
  code: 'SP',
  productionStatus: 'IN_PRODUCTION',
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  status: QuotationStatus.OPEN,
  approvedAt: null,
  deliveryInfo: mockDeliveryInfo,
  quotationPayment: mockQuotationPayment,
  quotationProduct: [],
  client: mockClient,
  series: mockSeries,
};

const mockOrder = {
  id: mockOrderId,
  quotationId: mockQuotationId,
  status: OrderStatus.IN_PRODUCTION,
};

// Mock sub-services
const createMockWorkflowService = () => ({
  approve: jest.fn(),
  billQuotation: jest.fn(),
  createProductionStages: jest.fn(),
  reject: jest.fn(),
  finish: jest.fn(),
  open: jest.fn(),
  checkTrialStatus: jest.fn(),
  validateClientForApproval: jest.fn(),
  createOrUpdateOrder: jest.fn(),
  createDeliveryScheduleForApproval: jest.fn(),
  handleApprovalFinancials: jest.fn(),
});

const createMockCrudService = () => ({
  create: jest.fn(),
  findAll: jest.fn(),
  findAllQuantity: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  duplicate: jest.fn(),
  findAllContactSources: jest.fn(),
  getUserIdFromEmployee: jest.fn(),
  recalculateQuotationTotalValue: jest.fn(),
});

const createMockItemsService = () => ({
  addProductToQuotation: jest.fn(),
  updateProductInQuotation: jest.fn(),
  duplicateProductInQuotation: jest.fn(),
  removeProductFromQuotation: jest.fn(),
  recalculateQuotationProductsTotalValue: jest.fn(),
  recalculateQuotationTotalValue: jest.fn(),
});

const createMockFinancialService = () => ({
  generateReceivableFromQuotation: jest.fn(),
  generatePayableFromQuotation: jest.fn(),
  shouldCreateCommissionPayable: jest.fn(),
  shouldCreateDeliveryPayable: jest.fn(),
  createCommissionPayable: jest.fn(),
  createDeliveryPayable: jest.fn(),
  findSalesCategories: jest.fn(),
  findCommissionCategories: jest.fn(),
  findDeliveryCategories: jest.fn(),
  getAvailablePaymentMethods: jest.fn(),
});

const createMockPdfService = () => ({
  getQuotationPdfData: jest.fn(),
});

const createMockImportService = () => ({
  deleteImportedQuotations: jest.fn(),
  importQuotationsFromCsv: jest.fn(),
});

describe('QuotationService', () => {
  let service: QuotationService;
  let workflowService: ReturnType<typeof createMockWorkflowService>;
  let crudService: ReturnType<typeof createMockCrudService>;
  let itemsService: ReturnType<typeof createMockItemsService>;
  let financialService: ReturnType<typeof createMockFinancialService>;
  let pdfService: ReturnType<typeof createMockPdfService>;
  let importService: ReturnType<typeof createMockImportService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    workflowService = createMockWorkflowService();
    crudService = createMockCrudService();
    itemsService = createMockItemsService();
    financialService = createMockFinancialService();
    pdfService = createMockPdfService();
    importService = createMockImportService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationService,
        { provide: QuotationCrudService, useValue: crudService },
        { provide: QuotationItemsService, useValue: itemsService },
        { provide: QuotationWorkflowService, useValue: workflowService },
        { provide: QuotationFinancialService, useValue: financialService },
        { provide: QuotationPdfService, useValue: pdfService },
        { provide: QuotationImportService, useValue: importService },
      ],
    }).compile();

    service = module.get<QuotationService>(QuotationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('approve', () => {
    it('should delegate to workflowService.approve', async () => {
      workflowService.approve.mockResolvedValue(mockOrder);

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBe(mockOrder);
      expect(workflowService.approve).toHaveBeenCalledWith(
        mockQuotationId,
        mockUserId,
      );
    });

    it('should propagate NotFoundException from workflowService', async () => {
      workflowService.approve.mockRejectedValue(
        new NotFoundException('Quotation not found'),
      );

      await expect(service.approve('invalid-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate BadRequestException from workflowService', async () => {
      workflowService.approve.mockRejectedValue(
        new BadRequestException('Client inactive'),
      );

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('CRUD delegations', () => {
    it('should delegate create to crudService', async () => {
      const dto = { companyId: mockCompanyId } as any;
      crudService.create.mockResolvedValue(mockQuotation);

      const result = await service.create(dto);

      expect(result).toBe(mockQuotation);
      expect(crudService.create).toHaveBeenCalledWith(dto);
    });

    it('should delegate findOne to crudService', async () => {
      crudService.findOne.mockResolvedValue(mockQuotation);

      const result = await service.findOne(mockQuotationId);

      expect(result).toBe(mockQuotation);
      expect(crudService.findOne).toHaveBeenCalledWith(mockQuotationId);
    });

    it('should delegate count to crudService', async () => {
      crudService.count.mockResolvedValue(42);

      const result = await service.count();

      expect(result).toBe(42);
      expect(crudService.count).toHaveBeenCalled();
    });

    it('should delegate duplicate to crudService', async () => {
      const dto = { description: 'Copy' } as any;
      crudService.duplicate.mockResolvedValue(mockQuotation);

      const result = await service.duplicate(mockQuotationId, dto, mockUserId);

      expect(result).toBe(mockQuotation);
      expect(crudService.duplicate).toHaveBeenCalledWith(
        mockQuotationId,
        dto,
        mockUserId,
      );
    });
  });

  describe('Item delegations', () => {
    it('should delegate addProductToQuotation to itemsService', async () => {
      const data = { productId: 'p1' } as any;
      itemsService.addProductToQuotation.mockResolvedValue({});

      await service.addProductToQuotation(mockQuotationId, data);

      expect(itemsService.addProductToQuotation).toHaveBeenCalledWith(
        mockQuotationId,
        data,
      );
    });

    it('should delegate removeProductFromQuotation to itemsService', async () => {
      itemsService.removeProductFromQuotation.mockResolvedValue({
        message: 'ok',
      });

      await service.removeProductFromQuotation('product-id');

      expect(itemsService.removeProductFromQuotation).toHaveBeenCalledWith(
        'product-id',
      );
    });
  });

  describe('Workflow delegations', () => {
    it('should delegate billQuotation to workflowService', async () => {
      workflowService.billQuotation.mockResolvedValue({});

      await service.billQuotation(mockQuotationId);

      expect(workflowService.billQuotation).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });

    it('should delegate reject to workflowService', async () => {
      const dto = { reason: 'test' } as any;
      workflowService.reject.mockResolvedValue(mockQuotation);

      await service.reject(mockQuotationId, dto, mockUserId);

      expect(workflowService.reject).toHaveBeenCalledWith(
        mockQuotationId,
        dto,
        mockUserId,
      );
    });

    it('should delegate finish to workflowService', async () => {
      workflowService.finish.mockResolvedValue(mockQuotation);

      await service.finish(mockQuotationId, mockUserId);

      expect(workflowService.finish).toHaveBeenCalledWith(
        mockQuotationId,
        mockUserId,
      );
    });

    it('should delegate open to workflowService', async () => {
      workflowService.open.mockResolvedValue(mockQuotation);

      await service.open(mockQuotationId, mockUserId);

      expect(workflowService.open).toHaveBeenCalledWith(
        mockQuotationId,
        mockUserId,
      );
    });
  });

  describe('PDF and Import delegations', () => {
    it('should delegate getQuotationPdfData to pdfService', async () => {
      pdfService.getQuotationPdfData.mockResolvedValue({ data: 'pdf' });

      await service.getQuotationPdfData(mockQuotationId);

      expect(pdfService.getQuotationPdfData).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });

    it('should delegate importQuotationsFromCsv to importService', async () => {
      importService.importQuotationsFromCsv.mockResolvedValue({
        success: true,
        message: 'ok',
        imported: 5,
      });

      await service.importQuotationsFromCsv('/path/to/file.csv', mockCompanyId);

      expect(importService.importQuotationsFromCsv).toHaveBeenCalledWith(
        '/path/to/file.csv',
        mockCompanyId,
      );
    });
  });
});

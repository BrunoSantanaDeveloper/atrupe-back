import { Test, TestingModule } from '@nestjs/testing';
import { QuotationService } from './quotation.service';

import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import {
  ApprovedOrder,
  QuotationWorkflowService,
} from './quotation-workflow.service';
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
        undefined,
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

      const result = await service.create(dto, undefined, mockCompanyId);

      expect(result).toBe(mockQuotation);
      expect(crudService.create).toHaveBeenCalledWith(
        dto,
        undefined,
        mockCompanyId,
      );
    });

    it('should delegate findOne to crudService', async () => {
      crudService.findOne.mockResolvedValue(mockQuotation);

      const result = await service.findOne(mockQuotationId);

      expect(result).toBe(mockQuotation);
      expect(crudService.findOne).toHaveBeenCalledWith(mockQuotationId);
    });

    it('should delegate count to crudService', async () => {
      crudService.count.mockResolvedValue(42);

      const result = await service.count(mockCompanyId);

      expect(result).toBe(42);
      expect(crudService.count).toHaveBeenCalledWith(mockCompanyId);
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

      await service.getQuotationPdfData(mockQuotationId, 'user-1');

      expect(pdfService.getQuotationPdfData).toHaveBeenCalledWith(
        mockQuotationId,
        'user-1',
        undefined,
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

    it('should delegate deleteImportedQuotations to importService', async () => {
      importService.deleteImportedQuotations.mockResolvedValue({
        success: true,
        message: 'ok',
        deleted: 3,
      });

      const result = await service.deleteImportedQuotations(mockCompanyId);

      expect(result).toEqual({
        success: true,
        message: 'ok',
        deleted: 3,
      });
      expect(importService.deleteImportedQuotations).toHaveBeenCalledWith(
        mockCompanyId,
      );
    });
  });

  describe('Additional CRUD delegations', () => {
    it('should delegate findAll to crudService', async () => {
      const dto = { companyId: mockCompanyId, page: 1, limit: 10 } as any;
      const expected = { data: [], meta: { total: 0 } };
      crudService.findAll.mockResolvedValue(expected);

      const result = await service.findAll(dto);

      expect(result).toBe(expected);
      expect(crudService.findAll).toHaveBeenCalledWith(dto);
    });

    it('should delegate findAllQuantity to crudService', async () => {
      const expected = { OPEN: 5, DONE: 3, TOTAL: 8 };
      crudService.findAllQuantity.mockResolvedValue(expected);

      const result = await service.findAllQuantity(mockCompanyId, 'seller-id');

      expect(result).toBe(expected);
      expect(crudService.findAllQuantity).toHaveBeenCalledWith(
        mockCompanyId,
        'seller-id',
      );
    });

    it('should delegate findAllQuantity without sellerId', async () => {
      crudService.findAllQuantity.mockResolvedValue({ TOTAL: 0 });

      await service.findAllQuantity(mockCompanyId);

      expect(crudService.findAllQuantity).toHaveBeenCalledWith(
        mockCompanyId,
        undefined,
      );
    });

    it('should delegate update to crudService', async () => {
      const dto = { description: 'Updated' } as any;
      crudService.update.mockResolvedValue({ ...mockQuotation, ...dto });

      const result = await service.update(
        mockQuotationId,
        dto,
        undefined,
        mockCompanyId,
      );

      expect(result.description).toBe('Updated');
      expect(crudService.update).toHaveBeenCalledWith(
        mockQuotationId,
        dto,
        undefined,
        mockCompanyId,
      );
    });

    it('should delegate remove to crudService', async () => {
      crudService.remove.mockResolvedValue({ id: mockQuotationId });

      const result = await service.remove(mockQuotationId);

      expect(result).toEqual({ id: mockQuotationId });
      expect(crudService.remove).toHaveBeenCalledWith(mockQuotationId);
    });

    it('should delegate findAllContactSources to crudService', async () => {
      const sources = [{ id: 's1', name: 'Google' }];
      crudService.findAllContactSources.mockResolvedValue(sources);

      const result = await service.findAllContactSources();

      expect(result).toBe(sources);
      expect(crudService.findAllContactSources).toHaveBeenCalled();
    });
  });

  describe('Additional Item delegations', () => {
    it('should delegate updateProductInQuotation to itemsService', async () => {
      const data = { quantity: 5 } as any;
      itemsService.updateProductInQuotation.mockResolvedValue({});

      await service.updateProductInQuotation('prod-id', data);

      expect(itemsService.updateProductInQuotation).toHaveBeenCalledWith(
        'prod-id',
        data,
      );
    });

    it('should delegate duplicateProductInQuotation to itemsService', async () => {
      itemsService.duplicateProductInQuotation.mockResolvedValue({
        id: 'new-prod',
      });

      const result = await service.duplicateProductInQuotation('prod-id');

      expect(result).toEqual({ id: 'new-prod' });
      expect(itemsService.duplicateProductInQuotation).toHaveBeenCalledWith(
        'prod-id',
      );
    });

    it('should delegate recalculateQuotationProductsTotalValue', async () => {
      itemsService.recalculateQuotationProductsTotalValue.mockResolvedValue(
        undefined,
      );

      await service.recalculateQuotationProductsTotalValue('qp-id');

      expect(
        itemsService.recalculateQuotationProductsTotalValue,
      ).toHaveBeenCalledWith('qp-id');
    });

    it('should delegate recalculateQuotationTotalValue', async () => {
      itemsService.recalculateQuotationTotalValue.mockResolvedValue(undefined);

      await service.recalculateQuotationTotalValue(mockQuotationId);

      expect(itemsService.recalculateQuotationTotalValue).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });
  });

  describe('Additional Workflow delegations', () => {
    it('should delegate createProductionStages', async () => {
      workflowService.createProductionStages.mockResolvedValue(undefined);

      await service.createProductionStages(mockQuotationId);

      expect(workflowService.createProductionStages).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });
  });

  describe('Financial delegations', () => {
    const mockPrisma = {} as any;
    const mockQuotationData = { id: 'q1' } as any;

    it('should delegate generateReceivableFromQuotation', async () => {
      financialService.generateReceivableFromQuotation.mockResolvedValue({});

      await service.generateReceivableFromQuotation(
        mockQuotationData,
        mockPrisma,
      );

      expect(
        financialService.generateReceivableFromQuotation,
      ).toHaveBeenCalledWith(mockQuotationData, mockPrisma);
    });

    it('should delegate generatePayableFromQuotation', async () => {
      financialService.generatePayableFromQuotation.mockResolvedValue({});

      await service.generatePayableFromQuotation(mockQuotationData, mockPrisma);

      expect(
        financialService.generatePayableFromQuotation,
      ).toHaveBeenCalledWith(mockQuotationData, mockPrisma);
    });

    it('should delegate shouldCreateCommissionPayable', async () => {
      const commission = { value: 100 };
      financialService.shouldCreateCommissionPayable.mockResolvedValue(true);

      const result = await service.shouldCreateCommissionPayable(
        commission,
        mockPrisma,
      );

      expect(result).toBe(true);
      expect(
        financialService.shouldCreateCommissionPayable,
      ).toHaveBeenCalledWith(commission, mockPrisma);
    });

    it('should delegate shouldCreateDeliveryPayable', () => {
      const delivery = { cost: 50 };
      financialService.shouldCreateDeliveryPayable.mockReturnValue(true);

      const result = service.shouldCreateDeliveryPayable(delivery);

      expect(result).toBe(true);
      expect(financialService.shouldCreateDeliveryPayable).toHaveBeenCalledWith(
        delivery,
      );
    });

    it('should delegate createCommissionPayable', async () => {
      const commission = { value: 100 };
      financialService.createCommissionPayable.mockResolvedValue({});

      await service.createCommissionPayable(
        mockQuotationData,
        commission,
        mockPrisma,
      );

      expect(financialService.createCommissionPayable).toHaveBeenCalledWith(
        mockQuotationData,
        commission,
        mockPrisma,
      );
    });

    it('should delegate createDeliveryPayable', async () => {
      const delivery = { cost: 50 };
      financialService.createDeliveryPayable.mockResolvedValue({});

      await service.createDeliveryPayable(
        mockQuotationData,
        delivery,
        mockPrisma,
      );

      expect(financialService.createDeliveryPayable).toHaveBeenCalledWith(
        mockQuotationData,
        delivery,
        mockPrisma,
      );
    });

    it('should delegate findSalesCategories', async () => {
      financialService.findSalesCategories.mockResolvedValue([]);

      await service.findSalesCategories(mockCompanyId, mockPrisma);

      expect(financialService.findSalesCategories).toHaveBeenCalledWith(
        mockCompanyId,
        mockPrisma,
      );
    });

    it('should delegate findCommissionCategories', async () => {
      financialService.findCommissionCategories.mockResolvedValue([]);

      await service.findCommissionCategories(mockCompanyId, mockPrisma);

      expect(financialService.findCommissionCategories).toHaveBeenCalledWith(
        mockCompanyId,
        mockPrisma,
      );
    });

    it('should delegate findDeliveryCategories', async () => {
      financialService.findDeliveryCategories.mockResolvedValue([]);

      await service.findDeliveryCategories(mockCompanyId, mockPrisma);

      expect(financialService.findDeliveryCategories).toHaveBeenCalledWith(
        mockCompanyId,
        mockPrisma,
      );
    });

    it('should delegate getAvailablePaymentMethods', async () => {
      financialService.getAvailablePaymentMethods.mockResolvedValue([
        'PIX',
        'BOLETO',
      ]);

      const result = await service.getAvailablePaymentMethods(
        mockCompanyId,
        mockClientId,
      );

      expect(result).toEqual(['PIX', 'BOLETO']);
      expect(financialService.getAvailablePaymentMethods).toHaveBeenCalledWith(
        mockCompanyId,
        mockClientId,
      );
    });

    it('should delegate getAvailablePaymentMethods without clientId', async () => {
      financialService.getAvailablePaymentMethods.mockResolvedValue([]);

      const result = await service.getAvailablePaymentMethods(mockCompanyId);

      expect(result).toEqual([]);
      expect(financialService.getAvailablePaymentMethods).toHaveBeenCalledWith(
        mockCompanyId,
        undefined,
      );
    });
  });

  // =======================================================================
  // CASOS ESPECÍFICOS DO PLANO DE TESTES (Prioridade 1 - God Node)
  // =======================================================================

  describe('Criação e Cálculo de Totais', () => {
    it('deve rejeitar cotação sem cliente associado no create', async () => {
      crudService.create.mockRejectedValue(
        new BadRequestException('Cliente é obrigatório'),
      );
      const dtoSemCliente = {
        companyId: mockCompanyId,
        sellerId: '123',
      } as any;

      await expect(
        service.create(dtoSemCliente, undefined, mockCompanyId),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve calcular total corretamente com múltiplos itens (delega para ItemsService)', async () => {
      itemsService.recalculateQuotationTotalValue.mockResolvedValue(undefined);
      await service.recalculateQuotationTotalValue(mockQuotationId);
      expect(itemsService.recalculateQuotationTotalValue).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });

    it('deve calcular total com desconto percentual e fixo (validação via ItemsService)', async () => {
      // Como o QuotationService é um Facade, garantimos que qualquer alteração de item
      // ou pagamento dispara o recálculo do total.
      itemsService.recalculateQuotationTotalValue.mockResolvedValue(undefined);
      await service.recalculateQuotationTotalValue(mockQuotationId);
      expect(itemsService.recalculateQuotationTotalValue).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });
  });

  describe('Financeiro e Parcelas', () => {
    it('deve gerar parcelas corretamente para pagamento parcelado (ON_ORDER)', async () => {
      workflowService.billQuotation.mockResolvedValue({ message: 'billed' });
      await service.billQuotation(mockQuotationId);
      expect(workflowService.billQuotation).toHaveBeenCalledWith(
        mockQuotationId,
      );
    });

    it('deve atualizar installments ao mudar condição de pagamento', async () => {
      const dto = {
        quotationPayment: { paymentConditionId: 'novo-id' },
      } as any;
      crudService.update.mockResolvedValue(mockQuotation);
      await service.update(mockQuotationId, dto, undefined, mockCompanyId);
      expect(crudService.update).toHaveBeenCalledWith(
        mockQuotationId,
        dto,
        undefined,
        mockCompanyId,
      );
    });
  });

  describe('Conversão para Pedido', () => {
    it('deve converter cotação em pedido mantendo todos os itens', async () => {
      workflowService.approve.mockResolvedValue(mockOrder);
      const order = await service.approve(mockQuotationId, mockUserId);
      expect(order).toBeDefined();
      expect((order as ApprovedOrder).status).toBe(OrderStatus.IN_PRODUCTION);
      expect(workflowService.approve).toHaveBeenCalledWith(
        mockQuotationId,
        mockUserId,
        undefined,
      );
    });

    it('não deve converter cotação com status CANCELADO (REJECTED)', async () => {
      workflowService.approve.mockRejectedValue(
        new BadRequestException('Quotation is REJECTED'),
      );
      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('PDF Transformers (delegações)', () => {
    it('deve mapear corretamente dados do cliente para PDF via PdfService', async () => {
      pdfService.getQuotationPdfData.mockResolvedValue({
        pdfData: '...',
      } as any);
      await service.getQuotationPdfData(mockQuotationId, 'user-1');
      expect(pdfService.getQuotationPdfData).toHaveBeenCalledWith(
        mockQuotationId,
        'user-1',
        undefined,
      );
    });
  });
});

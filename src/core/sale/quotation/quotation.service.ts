import { Injectable } from '@nestjs/common';
import { Quotation, Order } from '@prisma/client';
import { AddItemDto, CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateItemDto, UpdateQuotationDto } from './dto/update-quotation.dto';
import { DuplicateQuotationDto } from './dto/duplicate-quotation.dto';
import { FilterQuotationDto } from './dto/filter.dto';
import { CancelOrderDto } from '../order/dto/create-order.dto';

// Sub-services (Facade Pattern)
import { QuotationCrudService } from './quotation-crud.service';
import { QuotationItemsService } from './quotation-items.service';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { QuotationImportService } from './quotation-import.service';

export interface QuotationGroup {
  date: string;
  quotations: Quotation[];
}

/**
 * QuotationService - Pure Facade
 * Delega todas as operações para sub-services especializados.
 * Nenhuma lógica de negócio deve existir aqui.
 */
@Injectable()
export class QuotationService {
  constructor(
    private crudService: QuotationCrudService,
    private itemsService: QuotationItemsService,
    private workflowService: QuotationWorkflowService,
    private financialService: QuotationFinancialService,
    private pdfService: QuotationPdfService,
    private importService: QuotationImportService,
  ) {}

  // =====================================================
  // CRUD Operations → QuotationCrudService
  // =====================================================

  create(dto: CreateQuotationDto, userId?: string): Promise<Quotation> {
    return this.crudService.create(dto, userId);
  }

  findAll(dto: FilterQuotationDto) {
    return this.crudService.findAll(dto);
  }

  findAllForExport(dto: FilterQuotationDto) {
    return this.crudService.findAllForExport(dto);
  }

  findAllQuantity(companyId: string, sellerId?: string) {
    return this.crudService.findAllQuantity(companyId, sellerId);
  }

  findOne(id: string) {
    return this.crudService.findOne(id);
  }

  count(companyId: string) {
    return this.crudService.count(companyId);
  }

  update(id: string, dto: UpdateQuotationDto, userId?: string) {
    return this.crudService.update(id, dto, userId);
  }

  remove(id: string) {
    return this.crudService.remove(id);
  }

  duplicate(
    quotationId: string,
    duplicateDto: DuplicateQuotationDto,
    userId?: string,
  ): Promise<Quotation> {
    return this.crudService.duplicate(quotationId, duplicateDto, userId);
  }

  findAllContactSources(companyId?: string) {
    return this.crudService.findAllContactSources(companyId);
  }

  // =====================================================
  // Item Operations → QuotationItemsService
  // =====================================================

  addProductToQuotation(quotationId: string, data: AddItemDto) {
    return this.itemsService.addProductToQuotation(quotationId, data);
  }

  updateProductInQuotation(productId: string, data: UpdateItemDto) {
    return this.itemsService.updateProductInQuotation(productId, data);
  }

  duplicateProductInQuotation(productId: string): Promise<any> {
    return this.itemsService.duplicateProductInQuotation(productId);
  }

  removeProductFromQuotation(productId: string) {
    return this.itemsService.removeProductFromQuotation(productId);
  }

  getQuotationIdByProductId(productId: string) {
    return this.itemsService.getQuotationIdByProductId(productId);
  }

  recalculateQuotationProductsTotalValue(quotationProductId: string) {
    return this.itemsService.recalculateQuotationProductsTotalValue(
      quotationProductId,
    );
  }

  recalculateQuotationTotalValue(quotationId: string) {
    return this.itemsService.recalculateQuotationTotalValue(quotationId);
  }

  // =====================================================
  // Workflow Operations → QuotationWorkflowService
  // =====================================================

  approve(
    quotationId: string,
    userId?: string,
    approvedAt?: Date,
  ): Promise<Order> {
    return this.workflowService.approve(quotationId, userId, approvedAt);
  }

  billQuotation(quotationId: string) {
    return this.workflowService.billQuotation(quotationId);
  }

  createProductionStages(quotationId: string) {
    return this.workflowService.createProductionStages(quotationId);
  }

  reject(
    quotationId: string,
    dto: CancelOrderDto,
    userId?: string,
  ): Promise<Quotation> {
    return this.workflowService.reject(quotationId, dto, userId);
  }

  finish(quotationId: string, userId?: string): Promise<Quotation> {
    return this.workflowService.finish(quotationId, userId);
  }

  open(quotationId: string, userId?: string): Promise<Quotation> {
    return this.workflowService.open(quotationId, userId);
  }

  // =====================================================
  // Financial Operations → QuotationFinancialService
  // =====================================================

  generateReceivableFromQuotation(quotation: any, prisma: any) {
    return this.financialService.generateReceivableFromQuotation(
      quotation,
      prisma,
    );
  }

  generatePayableFromQuotation(quotation: any, prisma: any) {
    return this.financialService.generatePayableFromQuotation(
      quotation,
      prisma,
    );
  }

  shouldCreateCommissionPayable(
    commission: any,
    prisma: any,
  ): Promise<boolean> {
    return this.financialService.shouldCreateCommissionPayable(
      commission,
      prisma,
    );
  }

  shouldCreateDeliveryPayable(delivery: any): boolean {
    return this.financialService.shouldCreateDeliveryPayable(delivery);
  }

  createCommissionPayable(quotation: any, commission: any, prisma: any) {
    return this.financialService.createCommissionPayable(
      quotation,
      commission,
      prisma,
    );
  }

  createDeliveryPayable(quotation: any, delivery: any, prisma: any) {
    return this.financialService.createDeliveryPayable(
      quotation,
      delivery,
      prisma,
    );
  }

  findSalesCategories(companyId: string, prisma: any) {
    return this.financialService.findSalesCategories(companyId, prisma);
  }

  findCommissionCategories(companyId: string, prisma: any) {
    return this.financialService.findCommissionCategories(companyId, prisma);
  }

  findDeliveryCategories(companyId: string, prisma: any) {
    return this.financialService.findDeliveryCategories(companyId, prisma);
  }

  getAvailablePaymentMethods(
    companyId: string,
    clientId?: string,
  ): Promise<string[]> {
    return this.financialService.getAvailablePaymentMethods(
      companyId,
      clientId,
    );
  }

  // =====================================================
  // PDF Operations → QuotationPdfService
  // =====================================================

  getQuotationPdfData(id: string, userId?: string) {
    return this.pdfService.getQuotationPdfData(id, userId);
  }

  // =====================================================
  // Import Operations → QuotationImportService
  // =====================================================

  deleteImportedQuotations(
    companyId: string,
  ): Promise<{ success: boolean; message: string; deleted: number }> {
    return this.importService.deleteImportedQuotations(companyId);
  }

  importQuotationsFromCsv(
    filePath: string,
    companyId: string,
  ): Promise<{ success: boolean; message: string; imported: number }> {
    return this.importService.importQuotationsFromCsv(filePath, companyId);
  }
}

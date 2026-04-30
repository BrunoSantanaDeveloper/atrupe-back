import { Test, TestingModule } from '@nestjs/testing';
import { QuotationImportService } from './quotation-import.service';
import { PrismaService } from 'nestjs-prisma';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as fastCsv from 'fast-csv';

jest.mock('fs');
jest.mock('fast-csv');

describe('QuotationImportService', () => {
  let service: QuotationImportService;
  let prismaMock: any;
  let workflowMock: any;

  beforeEach(async () => {
    prismaMock = {
      quotation: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      quotationProductItem: { deleteMany: jest.fn(), create: jest.fn() },
      quotationProduct: { deleteMany: jest.fn(), create: jest.fn() },
      quotationInstallment: { deleteMany: jest.fn(), create: jest.fn() },
      quotationPayment: { deleteMany: jest.fn(), create: jest.fn() },
      deliveryInfo: { deleteMany: jest.fn(), create: jest.fn() },
      deliverySchedule: { deleteMany: jest.fn() },
      productionStage: { deleteMany: jest.fn() },
      order: { deleteMany: jest.fn() },
      employee: { findFirst: jest.fn() },
      paymentMethod: { findMany: jest.fn() },
      paymentCondition: { findFirst: jest.fn() },
      saleSeries: { findFirst: jest.fn() },
      client: { findFirst: jest.fn() },
      product: { findFirst: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (cb) => {
        return cb(prismaMock);
      }),
    };

    workflowMock = {
      approve: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationImportService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: QuotationWorkflowService, useValue: workflowMock },
      ],
    }).compile();

    service = module.get<QuotationImportService>(QuotationImportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('deleteImportedQuotations', () => {
    it('deve deletar todos os orçamentos importados e suas relações via transação', async () => {
      prismaMock.quotation.findMany.mockResolvedValue([
        { id: 'q1' },
        { id: 'q2' },
      ]);
      prismaMock.quotation.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.deleteImportedQuotations('company-1');

      expect(prismaMock.quotation.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        select: { id: true },
      });
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.quotationProductItem.deleteMany).toHaveBeenCalled();
      expect(prismaMock.quotation.deleteMany).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);
    });

    it('deve lançar exceção caso ocorra erro na transação', async () => {
      prismaMock.quotation.findMany.mockRejectedValue(new Error('DB Error'));

      await expect(
        service.deleteImportedQuotations('company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('importQuotationsFromCsv', () => {
    it('deve lançar erro se vendedor admin não for encontrado', async () => {
      prismaMock.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.importQuotationsFromCsv('dummy.csv', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve lançar erro se métodos de pagamento não forem encontrados', async () => {
      prismaMock.employee.findFirst.mockResolvedValue({ id: 'admin-1' });
      prismaMock.paymentMethod.findMany.mockResolvedValue([]);

      await expect(
        service.importQuotationsFromCsv('dummy.csv', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve importar orçamentos com sucesso', async () => {
      prismaMock.employee.findFirst.mockResolvedValue({ id: 'admin-1' });
      prismaMock.paymentMethod.findMany.mockResolvedValue([{ id: 'pm-1' }]);
      prismaMock.saleSeries.findFirst.mockResolvedValue({
        id: 'serie-1',
        proposalValidity: 10,
      });
      prismaMock.paymentCondition.findFirst.mockResolvedValue({ id: 'pc-1' });

      // Mock file operations
      (fs.openSync as jest.Mock).mockReturnValue(1);
      (fs.readSync as jest.Mock).mockReturnValue(10);
      (fs.closeSync as jest.Mock).mockImplementation(() => {});

      const mockCsvData = [
        {
          venda_serie: 'S1',
          cliente_nome: 'Cliente A',
          cadastro_dt: '2023-01-01T00:00:00Z',
          venda_numero: '100',
          venda_valor_total: '500.00',
          confsubstatus_descr: 'Digitação',
          fkidtipoentrega: '1',
          venda_valor_final: '500.00',
          venda_valor_desconto: '0',
          vendaitem_referencia: 'Produto X',
          vendaitem_valor_item: '500.00',
          vendaitem_quantidade: '1',
        },
      ];

      const pipeMock: any = {
        on: jest.fn().mockReturnThis(),
      };
      pipeMock.on.mockImplementation(
        (event: string, cb: (...args: any[]) => void) => {
          if (event === 'data') {
            setTimeout(() => cb(mockCsvData[0]), 0);
          }
          if (event === 'end') {
            setTimeout(() => cb(), 10);
          }
          return pipeMock;
        },
      );

      const streamMock: any = {
        pipe: jest.fn().mockReturnValue(pipeMock),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(streamMock);
      (fastCsv.parse as jest.Mock).mockReturnValue({});

      prismaMock.quotation.create.mockResolvedValue({
        id: 'quote-1',
        dueDate: new Date(),
      });
      prismaMock.quotationPayment.create.mockResolvedValue({ id: 'payment-1' });
      prismaMock.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        items: [{ id: 'item-1' }],
      });
      prismaMock.quotationProduct.create.mockResolvedValue({ id: 'qprod-1' });

      const result = await service.importQuotationsFromCsv(
        'dummy.csv',
        'company-1',
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(1);
      expect(prismaMock.quotation.create).toHaveBeenCalled();
    });
  });
});

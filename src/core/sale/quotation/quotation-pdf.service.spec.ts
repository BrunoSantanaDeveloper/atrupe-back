import { Test, TestingModule } from '@nestjs/testing';
import { QuotationPdfService } from './quotation-pdf.service';
import { PrismaService } from 'nestjs-prisma';
import { QuotationFinancialService } from './quotation-financial.service';
import { InternalServerErrorException } from '@nestjs/common';
import * as pdfTransformers from './quotation-pdf.transformers';

jest.mock('./quotation-pdf.transformers');

describe('QuotationPdfService', () => {
  let service: QuotationPdfService;
  let prismaMock: any;
  let financialServiceMock: any;

  beforeEach(async () => {
    prismaMock = {
      quotation: {
        findUnique: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
      },
    };

    financialServiceMock = {
      getAvailablePaymentMethods: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationPdfService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: QuotationFinancialService, useValue: financialServiceMock },
      ],
    }).compile();

    service = module.get<QuotationPdfService>(QuotationPdfService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('getQuotationPdfData', () => {
    it('deve retornar os dados formatados para PDF com sucesso', async () => {
      const mockQuotation = { id: 'q-1', companyId: 'c-1', clientId: 'cli-1' };
      const mockPaymentMethods = [{ id: 'pm-1' }];
      const mockTransformedData = { id: 'q-1', pdfReady: true };

      prismaMock.quotation.findUnique.mockResolvedValue(mockQuotation);
      financialServiceMock.getAvailablePaymentMethods.mockResolvedValue(
        mockPaymentMethods,
      );
      (
        pdfTransformers.transformQuotationToPdfData as jest.Mock
      ).mockReturnValue(mockTransformedData);

      const result = await service.getQuotationPdfData('q-1');

      expect(prismaMock.quotation.findUnique).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        include: expect.any(Object),
      });
      expect(
        financialServiceMock.getAvailablePaymentMethods,
      ).toHaveBeenCalledWith('c-1', 'cli-1');
      expect(prismaMock.employee.findFirst).not.toHaveBeenCalled();
      expect(pdfTransformers.transformQuotationToPdfData).toHaveBeenCalledWith(
        mockQuotation,
        mockPaymentMethods,
        null,
      );
      expect(result).toEqual(mockTransformedData);
    });

    it('deve usar a assinatura do colaborador logado (userId) ao gerar o PDF', async () => {
      const mockQuotation = { id: 'q-1', companyId: 'c-1', clientId: 'cli-1' };
      const mockPaymentMethods = [{ id: 'pm-1' }];
      const mockTransformedData = { id: 'q-1', pdfReady: true };

      prismaMock.quotation.findUnique.mockResolvedValue(mockQuotation);
      prismaMock.employee.findFirst.mockResolvedValue({
        signatureUrl: 'https://example.com/employee-signature.png',
      });
      financialServiceMock.getAvailablePaymentMethods.mockResolvedValue(
        mockPaymentMethods,
      );
      (
        pdfTransformers.transformQuotationToPdfData as jest.Mock
      ).mockReturnValue(mockTransformedData);

      await service.getQuotationPdfData('q-1', 'user-1');

      expect(prismaMock.employee.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', companyId: 'c-1' },
        select: { signatureUrl: true },
      });
      expect(pdfTransformers.transformQuotationToPdfData).toHaveBeenCalledWith(
        mockQuotation,
        mockPaymentMethods,
        'https://example.com/employee-signature.png',
      );
    });

    it('deve lançar InternalServerErrorException (contendo NotFound) se orçamento não for encontrado', async () => {
      prismaMock.quotation.findUnique.mockResolvedValue(null);

      // O catch do getQuotationPdfData converte qualquer erro (incluindo NotFound) para InternalServerErrorException.
      await expect(service.getQuotationPdfData('q-invalid')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('deve lançar InternalServerErrorException se ocorrer falha na busca', async () => {
      prismaMock.quotation.findUnique.mockRejectedValue(new Error('DB Error'));

      await expect(service.getQuotationPdfData('q-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});

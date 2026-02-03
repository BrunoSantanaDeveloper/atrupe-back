import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { QUOTATION_PDF_DATA_INCLUDE } from './quotation-pdf.includes';
import { transformQuotationToPdfData } from './quotation-pdf.transformers';
import { QuotationFinancialService } from './quotation-financial.service';

/**
 * QuotationPdfService
 * Responsável por geração de dados para PDF do orçamento.
 */
@Injectable()
export class QuotationPdfService {
  constructor(
    private prisma: PrismaService,
    private financialService: QuotationFinancialService,
  ) {}

  /**
   * Retorna dados formatados do orçamento para geração de PDF
   */
  async getQuotationPdfData(id: string) {
    try {
      const quotation = await this.prisma.quotation.findUnique({
        where: { id },
        include: QUOTATION_PDF_DATA_INCLUDE,
      });

      if (!quotation) {
        throw new NotFoundException('Quotation not found');
      }

      // Buscar métodos de pagamento disponíveis (operação async separada)
      const availablePaymentMethods =
        await this.financialService.getAvailablePaymentMethods(
          quotation.companyId,
          quotation.clientId,
        );

      return transformQuotationToPdfData(
        quotation as any,
        availablePaymentMethods,
      );
    } catch (error) {
      console.error('Error generating quotation PDF data:', error);
      throw new InternalServerErrorException(
        'Failed to generate quotation PDF data',
      );
    }
  }
}

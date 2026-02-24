import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
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
  private readonly logger = new Logger(QuotationPdfService.name);

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
        throw new NotFoundException('Orçamento não encontrado');
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
      this.logger.error('Error generating quotation PDF data:', error.stack);
      throw new InternalServerErrorException(
        'Falha ao gerar dados do PDF do orçamento',
      );
    }
  }
}

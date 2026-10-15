import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { QUOTATION_PDF_DATA_INCLUDE } from './quotation-pdf.includes';
import {
  PdfOptions,
  transformQuotationToPdfData,
} from './quotation-pdf.transformers';
import { QuotationFinancialService } from './quotation-financial.service';

const METHOD_NAME: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CARD: 'Cartão',
};

/** O recebimento da venda no caixa para o comprovante (FC-16). */
const cashReceiptOf = (sale: {
  path: string;
  total: number;
  paid: number;
  discount: number;
  change: number;
  delivered: boolean;
  cancelled: boolean;
  parts: unknown;
}) => ({
  path: sale.path,
  total: sale.total,
  paid: sale.paid,
  remaining: Math.max(0, sale.total - sale.paid),
  discount: sale.discount,
  change: sale.change,
  delivered: sale.delivered,
  cancelled: sale.cancelled,
  parts: (Array.isArray(sale.parts)
    ? (sale.parts as { method: string; amount: number }[])
    : []
  ).map((part) => ({
    method: part.method,
    label: METHOD_NAME[part.method] ?? part.method,
    amount: part.amount,
  })),
});

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
  async getQuotationPdfData(id: string, userId?: string, options?: PdfOptions) {
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

      // Assinatura exibida no PDF é a do colaborador logado que está
      // gerando o documento, não a do vendedor atribuído ao orçamento
      const loggedEmployee = userId
        ? await this.prisma.employee.findFirst({
            where: { userId, companyId: quotation.companyId },
            select: { signatureUrl: true },
          })
        : null;

      const data = transformQuotationToPdfData(
        quotation as any,
        availablePaymentMethods,
        loggedEmployee?.signatureUrl ?? null,
        options,
      );
      // A venda rápida recebida no caixa: o comprovante a pedido (FC-16)
      // mostra as formas, o troco e o que falta, em centavos
      const sale = await this.prisma.pendingSale.findUnique({
        where: { quotationId: id },
      });
      return sale ? { ...data, cashReceipt: cashReceiptOf(sale) } : data;
    } catch (error) {
      this.logger.error('Error generating quotation PDF data:', error.stack);
      throw new InternalServerErrorException(
        'Falha ao gerar dados do PDF do orçamento',
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PdfService, PdfStructure } from 'src/svc/pdf/pdf.service';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  constructor(private readonly pdfService: PdfService) {}

  async create(dto: CreateInvoiceDto) {
    this.logger.debug('Criando invoice');
    const invoice: PdfStructure = {
      header: 'Recibo',
      body: 'Recibi(emos) de Atrupe o valor de R$ 70,00 (setenta reais) na data de 08 de Abril de 2024 correspondente aos itens descritos 05/04/2024 R$ 70,00 Venda 68-V1 - teste 25 (Cópia) (Cópia) e para clareza firmo(amos) o presente.',
      footer: 'Thank you for your business',
    };

    const pdfBuffer = await this.pdfService.generate(invoice);

    return pdfBuffer;
  }
}

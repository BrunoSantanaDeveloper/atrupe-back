import { Injectable } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PdfService, PdfStructure } from 'src/svc/pdf/pdf.service';

@Injectable()
export class InvoiceService {
  constructor(private readonly pdfService: PdfService) {}

  async create(dto: CreateInvoiceDto) {
    console.log(dto);

    const invoice: PdfStructure = {
      header: 'Recibo',
      body: 'Recibi(emos) de Atrupe o valor de R$ 70,00 (setenta reais) na data de 08 de Abril de 2024 correspondente aos itens descritos 05/04/2024 R$ 70,00 Venda 68-V1 - teste 25 (Cópia) (Cópia) e para clareza firmo(amos) o presente.',
      footer: 'Thank you for your business',
    };

    const pdfBuffer = await this.pdfService.generate(invoice);

    return pdfBuffer;
  }

  // findAll() {
  //   return this.prisma.invoice.findMany();
  // }

  // findOne(id: string) {
  //   return this.prisma.invoice.findUnique({
  //     where: {
  //       id,
  //     },
  //   });
  // }

  // update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
  //   return this.prisma.invoice.update({
  //     where: {
  //       id,
  //     },
  //     data: {
  //       ...updateInvoiceDto,
  //     },
  //   });
  // }

  // remove(id: string) {
  //   return this.prisma.invoice.delete({
  //     where: {
  //       id,
  //     },
  //   });
  // }
}

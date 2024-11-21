import { Injectable } from '@nestjs/common';
import * as jspdf from 'jspdf';

export interface PdfStructure {
  header: string;
  body: string;
  footer: string;
}

@Injectable()
export class PdfService {
  async generate(data: PdfStructure) {
    try {
      const doc = new jspdf.jsPDF('p', 'pt', 'a4');

      // Page sizes
      const pageSize = doc.internal.pageSize;
      const pageWidth = pageSize.width ? pageSize.width : pageSize.getWidth();
      const pageHeight = pageSize.height
        ? pageSize.height
        : pageSize.getHeight();

      // Header
      doc.text(data.header, 40, 15, { baseline: 'top' });

      // Footer
      doc.line(40, pageHeight - 40, pageWidth - 40, pageHeight - 40);
      data.footer =
        'Atrupe Sistemas | Getúlio Vargas, n 162, Vila Operária, ITAJAÍ - SC | (47) 98406-4148';
      doc
        .setFontSize(12)
        .text(
          data.footer,
          pageWidth / 2 - doc.getTextWidth(data.footer) / 2,
          pageHeight - 15,
          { baseline: 'bottom' },
        );

      const blob = new Blob([doc.output('blob')], {
        type: 'application/pdf',
      });

      return Buffer.from(await blob.arrayBuffer());
    } catch (error) {
      console.error('Error generating PDF', error);
      throw error;
    }
  }
}

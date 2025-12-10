import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

/**
 * Serviço especializado para importação de orçamentos
 *
 * NOTA: A implementação completa de importação de orçamentos já existe
 * em QuotationService.importQuotationsFromCsv()
 *
 * Este serviço serve como interface para o sistema de importação genérico.
 */
@Injectable()
export class QuotationImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processar importação (interface compatível com ImportProcessor)
   *
   * Para importação completa, use o endpoint existente:
   * POST /sale/quotation/import-csv
   */
  async processImport(
    importLog: any,
    options: any,
  ): Promise<{
    successRows: number;
    failedRows: number;
    errors: any[];
  }> {
    // Implementação placeholder
    // A importação real está em QuotationService
    return {
      successRows: 0,
      failedRows: 0,
      errors: [
        {
          message:
            'Use the existing endpoint POST /sale/quotation/import-csv for full quotation import functionality',
        },
      ],
    };
  }
}

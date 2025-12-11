import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { MinioService } from '../../svc/file-upload/minio.service';
import { ImportStatus } from '@prisma/client';
import * as csv from 'fast-csv';
import { Readable } from 'stream';
import { ImportStatusDto } from './dto';
import {
  CLIENT_IMPORT_SCHEMA,
  PRODUCT_IMPORT_SCHEMA,
  QUOTATION_IMPORT_SCHEMA,
  ORDER_IMPORT_SCHEMA,
  FINANCIAL_IMPORT_SCHEMA,
} from './schemas';

@Injectable()
export class ImportService {
  private fileBuffers: Map<string, Buffer> = new Map();

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {}

  /**
   * Criar registro de importação e fazer upload do arquivo
   */
  async createImport(
    file: Express.Multer.File,
    entity: string,
    userId: string,
    companyId: string,
  ) {
    // Validar entidade
    const allowedEntities = ['client', 'product', 'quotation', 'supplier'];
    if (!allowedEntities.includes(entity)) {
      throw new BadRequestException('Invalid entity type');
    }

    // Validar formato do arquivo
    if (!file.originalname.endsWith('.csv')) {
      throw new BadRequestException('Only CSV files are allowed');
    }

    try {
      // Por enquanto, armazenar o arquivo em memória
      // Em produção, usar MinIO:
      // await this.minioService.createBucketIfNotExists();
      // const fileUrl = await this.minioService.uploadFile(file);

      // Criar registro no banco
      const importLog = await this.prisma.importLog.create({
        data: {
          entity,
          userId,
          companyId,
          fileName: file.originalname,
          fileSize: file.size,
          fileUrl: 'in-memory', // Placeholder - em produção usar URL do MinIO
          status: ImportStatus.QUEUED,
        },
      });

      // Armazenar buffer do arquivo em memória para processamento posterior
      this.fileBuffers.set(importLog.id, file.buffer);

      return importLog;
    } catch (error) {
      console.error('Error creating import:', error);
      throw new BadRequestException(
        `Failed to upload file: ${error.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Validar CSV antes de importar
   */
  async validateCsv(importId: string): Promise<any> {
    const importLog = await this.prisma.importLog.findUnique({
      where: { id: importId },
    });

    if (!importLog) {
      throw new BadRequestException('Import not found');
    }

    // Atualizar status
    await this.prisma.importLog.update({
      where: { id: importId },
      data: { status: ImportStatus.VALIDATING },
    });

    try {
      // Obter arquivo do buffer em memória
      const fileBuffer = this.fileBuffers.get(importId);

      if (!fileBuffer) {
        throw new BadRequestException(
          'File not found. Please upload the file again.',
        );
      }

      // Parse CSV
      const rows = await this.parseCsv(fileBuffer);

      // Validar schema
      const schema = this.getSchema(importLog.entity);
      const validationResult = await this.validateRows(
        rows,
        schema,
        importLog.companyId,
      );

      // Atualizar registro
      await this.prisma.importLog.update({
        where: { id: importId },
        data: {
          totalRows: rows.length,
          errors: validationResult.errors,
          status:
            validationResult.errors.length > 0
              ? ImportStatus.FAILED
              : ImportStatus.QUEUED,
        },
      });

      // NÃO limpar buffer aqui - será necessário para o processamento
      // O buffer será limpo apenas após o processamento ou em caso de erro FATAL

      return {
        importId,
        valid: validationResult.errors.length === 0,
        totalRows: rows.length,
        validRows: validationResult.validRows,
        errors: validationResult.errors,
        preview: rows.slice(0, 10),
      };
    } catch (error) {
      // Limpar buffer da memória em caso de erro de validação
      this.fileBuffers.delete(importId);

      await this.prisma.importLog.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          errors: [{ message: error.message }],
        },
      });
      throw error;
    }
  }

  /**
   * Parse CSV file
   */
  parseCsv(buffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const rows: any[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv.parse({ headers: true, trim: true }))
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', (error) => reject(error));
    });
  }

  /**
   * Obter schema de validação baseado na entidade
   */
  private getSchema(entity: string): any {
    const schemas = {
      client: CLIENT_IMPORT_SCHEMA,
      product: PRODUCT_IMPORT_SCHEMA,
      quotation: QUOTATION_IMPORT_SCHEMA,
      order: ORDER_IMPORT_SCHEMA,
      financial: FINANCIAL_IMPORT_SCHEMA,
    };

    return schemas[entity];
  }

  /**
   * Validar linhas do CSV
   */
  private async validateRows(
    rows: any[],
    schema: any,
    companyId: string,
  ): Promise<any> {
    const errors: any[] = [];
    let validRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 porque linha 1 é header e array começa em 0

      const rowErrors = await this.validateRow(
        row,
        schema,
        companyId,
        rowNumber,
      );

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        validRows++;
      }
    }

    return { validRows, errors };
  }

  /**
   * Validar uma linha específica
   */
  private async validateRow(
    row: any,
    schema: any,
    companyId: string,
    rowNumber: number,
  ): Promise<any[]> {
    const errors: any[] = [];

    for (const field of schema.fields) {
      const value = row[field.name];

      // Validar campo obrigatório
      if (field.required && (!value || value.trim() === '')) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value: value || '',
          error: `Campo '${field.name}' é obrigatório`,
        });
        continue;
      }

      // Se campo não obrigatório e vazio, pular outras validações
      if (!value || value.trim() === '') {
        continue;
      }

      // Validar tipo
      if (field.type === 'email' && !this.isValidEmail(value)) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: `Formato de email inválido`,
        });
      }

      // Validar pattern (regex)
      if (field.pattern && !field.pattern.test(value)) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: `Valor não corresponde ao padrão esperado`,
        });
      }

      // Validar tamanho máximo
      if (field.maxLength && value.length > field.maxLength) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: `Valor excede o tamanho máximo de ${field.maxLength} caracteres`,
        });
      }

      // Validações customizadas
      if (field.validate) {
        const customError = await field.validate(value, companyId, this.prisma);
        if (customError) {
          errors.push({
            row: rowNumber,
            field: field.name,
            value,
            error: customError,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validar email
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Obter status da importação
   */
  async getImportStatus(importId: string): Promise<ImportStatusDto> {
    const importLog = await this.prisma.importLog.findUnique({
      where: { id: importId },
    });

    if (!importLog) {
      throw new BadRequestException('Import not found');
    }

    const progress =
      importLog.totalRows > 0
        ? Math.round((importLog.successRows / importLog.totalRows) * 100)
        : 0;

    return {
      id: importLog.id,
      entity: importLog.entity,
      status: importLog.status,
      fileName: importLog.fileName,
      totalRows: importLog.totalRows,
      successRows: importLog.successRows,
      failedRows: importLog.failedRows,
      progress,
      errors: importLog.errors as any[],
      startedAt: importLog.startedAt,
      completedAt: importLog.completedAt,
    };
  }

  /**
   * Processar importação após validação
   */
  async processImport(importId: string): Promise<any> {
    const importLog = await this.prisma.importLog.findUnique({
      where: { id: importId },
    });

    if (!importLog) {
      throw new BadRequestException('Import not found');
    }

    if (importLog.status !== ImportStatus.QUEUED) {
      throw new BadRequestException(
        'Import must be validated before processing',
      );
    }

    // Atualizar status para PROCESSING
    await this.prisma.importLog.update({
      where: { id: importId },
      data: {
        status: ImportStatus.PROCESSING,
        startedAt: new Date(),
      },
    });

    try {
      // Obter arquivo do buffer
      const fileBuffer = this.fileBuffers.get(importId);

      if (!fileBuffer) {
        throw new BadRequestException(
          'File not found. Please upload the file again.',
        );
      }

      // Parse CSV novamente
      const rows = await this.parseCsv(fileBuffer);

      let successCount = 0;
      let failedCount = 0;
      const errors: any[] = [];

      // Processar cada linha
      if (importLog.entity === 'quotation') {
        // Para orçamentos, processar todos de uma vez (estrutura complexa com múltiplas linhas por orçamento)
        const result = await this.importQuotations(rows, importLog.companyId);
        successCount = result.successCount;
        failedCount = result.failedCount;
        errors.push(...result.errors);
      } else if (importLog.entity === 'order') {
        // Para ordens de serviço, processar todos de uma vez (estrutura complexa com múltiplas linhas por ordem)
        const result = await this.importOrders(rows, importLog.companyId);
        successCount = result.successCount;
        failedCount = result.failedCount;
        errors.push(...result.errors);
      } else if (importLog.entity === 'financial') {
        // Para lançamentos financeiros, processar todos de uma vez (estrutura complexa com múltiplas parcelas por lançamento)
        const result = await this.importFinancial(rows, importLog.companyId);
        successCount = result.successCount;
        failedCount = result.failedCount;
        errors.push(...result.errors);
      } else {
        // Para outras entidades, processar linha por linha
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNumber = i + 2;

          try {
            if (importLog.entity === 'client') {
              await this.importClient(row, importLog.companyId);
            } else if (importLog.entity === 'product') {
              await this.importProduct(row, importLog.companyId);
            }

            successCount++;
          } catch (error) {
            failedCount++;
            errors.push({
              row: rowNumber,
              error: error.message,
            });
          }
        }
      }

      // Limpar buffer após processamento
      this.fileBuffers.delete(importId);

      // Atualizar registro final
      await this.prisma.importLog.update({
        where: { id: importId },
        data: {
          status: ImportStatus.COMPLETED,
          successRows: successCount,
          failedRows: failedCount,
          completedAt: new Date(),
          errors: errors.length > 0 ? errors : [],
        },
      });

      return {
        importId,
        successRows: successCount,
        failedRows: failedCount,
        errors,
      };
    } catch (error) {
      // Limpar buffer em caso de erro
      this.fileBuffers.delete(importId);

      await this.prisma.importLog.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          completedAt: new Date(),
          errors: [{ message: error.message }],
        },
      });
      throw error;
    }
  }

  /**
   * Importar um cliente do CSV
   */
  private async importClient(row: any, companyId: string): Promise<void> {
    // Normalizar tipo
    let type = row.type?.toUpperCase();
    if (type === 'F') type = 'PERSON';
    if (type === 'J') type = 'COMPANY';

    // Criar cliente
    await this.prisma.client.create({
      data: {
        companyId,
        type: type || 'PERSON',
        name: row.name,
        email: row.email || null,
        cpf: row.cpf || null,
        cnpj: row.cnpj || null,
        rg: row.rg || null,
        phone: row.phone || null,
        mobile: row.mobile || null,
        activity: row.activity || null,
        corporateName: row.corporateName || null,
        notes: row.notes || null,
        address: row.cep
          ? {
              create: [
                {
                  type: 'Principal',
                  zipcode: row.cep || null,
                  street: row.rua || null,
                  number: row.numero || null,
                  complement: row.complemento || null,
                  neighborhood: row.bairro || null,
                  city: row.cidade || null,
                  state: row.uf || null,
                },
              ],
            }
          : undefined,
      },
    });
  }

  /**
   * Importar um produto do CSV
   */
  private async importProduct(row: any, companyId: string): Promise<void> {
    // Buscar categoria por nome (já validado, então deve existir)
    const category = await this.prisma.category.findFirst({
      where: {
        name: row.categoria,
        companyId,
      },
    });

    // Buscar setor por nome (já validado, então deve existir)
    const sector = await this.prisma.companySector.findFirst({
      where: {
        name: row.setor,
        companyId,
      },
    });

    // Criar produto
    const product = await this.prisma.product.create({
      data: {
        companyId,
        code: row.codigo,
        name: row.nome,
        technicalDescription: row.descricao || null,
        categoryId: category.id,
        sectorId: sector.id,
        isActive: true,
        status: 'ACTIVE',
      },
    });

    // Se houver dados do serviço 1, criar ProductItem
    if (row.servico1 && row.servico1.trim() !== '') {
      // Buscar unidade de medida
      let unitOfMeasureId = null;
      if (row.servico1UnidadeMedida) {
        const unitOfMeasure = await this.prisma.defaultUnitOfMeasure.findFirst({
          where: {
            code: row.servico1UnidadeMedida.toUpperCase(),
          },
        });
        unitOfMeasureId = unitOfMeasure?.id || null;
      }

      await this.prisma.productItem.create({
        data: {
          productId: product.id,
          name: row.servico1,
          width: row.servico1Largura ? parseFloat(row.servico1Largura) : null,
          height: row.servico1Altura ? parseFloat(row.servico1Altura) : null,
          unitCost: row.servico1Custo ? parseFloat(row.servico1Custo) : null,
          salePrice: row.servico1Preco ? parseFloat(row.servico1Preco) : null,
          defaultUnitOfMeasureId: unitOfMeasureId,
        },
      });
    }
  }

  /**
   * Importar orçamentos do CSV (agrupa linhas por NumeroVenda)
   */
  private async importQuotations(
    rows: any[],
    companyId: string,
  ): Promise<{ successCount: number; failedCount: number; errors: any[] }> {
    const errors: any[] = [];
    let successCount = 0;
    let failedCount = 0;

    // Agrupar linhas por NumeroVenda + Serie
    const quotationsMap = new Map<string, any[]>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = `${row.NumeroVenda}-${row.Serie}`;

      if (!quotationsMap.has(key)) {
        quotationsMap.set(key, []);
      }
      quotationsMap.get(key)!.push({ ...row, rowNumber: i + 2 });
    }

    // Processar cada orçamento
    for (const [key, items] of quotationsMap.entries()) {
      try {
        const firstItem = items[0];

        // Buscar série
        const series = await this.prisma.saleSeries.findFirst({
          where: {
            code: firstItem.Serie,
            companyId,
            isActive: true,
          },
        });

        if (!series) {
          throw new Error(`Série '${firstItem.Serie}' não encontrada`);
        }

        // Buscar cliente por CPF/CNPJ
        const cleanCpfCnpj = firstItem.ClienteCpfCnpj.replace(/[^\d]/g, '');
        const client = await this.prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
            ],
          },
        });

        if (!client) {
          throw new Error(
            `Cliente com CPF/CNPJ '${firstItem.ClienteCpfCnpj}' não encontrado`,
          );
        }

        // Buscar vendedor
        const seller = await this.prisma.employee.findFirst({
          where: {
            user: {
              email: firstItem.VendedorEmail,
            },
            companyId,
            isActive: true,
          },
        });

        if (!seller) {
          throw new Error(
            `Vendedor '${firstItem.VendedorEmail}' não encontrado`,
          );
        }

        // Mapear status
        let status: 'OPEN' | 'DONE' | 'REJECTED' | 'OVERDUE' = 'OPEN';
        if (firstItem.Status === 'APROVADO' || firstItem.Status === 'DONE') {
          status = 'DONE';
        } else if (
          firstItem.Status === 'REJEITADO' ||
          firstItem.Status === 'REJECTED'
        ) {
          status = 'REJECTED';
        }

        // Criar orçamento
        const quotation = await this.prisma.quotation.create({
          data: {
            companyId,
            seriesId: series.id,
            clientId: client.id,
            sellerId: seller.id,
            status,
            description: firstItem.ObservacaoItem || null,
            dueDate: firstItem.DataValidade
              ? new Date(firstItem.DataValidade)
              : null,
            quotationNumber: parseInt(firstItem.NumeroVenda),
            totalValue: 0, // Será calculado depois
          },
        });

        let quotationTotalValue = 0;

        // Processar cada item do orçamento
        for (const item of items) {
          // Buscar produto
          const product = await this.prisma.product.findUnique({
            where: {
              code_companyId: {
                code: item.ProdutoCodigo,
                companyId,
              },
            },
            include: {
              items: true,
            },
          });

          if (!product) {
            throw new Error(`Produto '${item.ProdutoCodigo}' não encontrado`);
          }

          const itemTotalValue = parseFloat(item.ValorTotal);
          quotationTotalValue += itemTotalValue;

          // Criar QuotationProduct
          const quotationProduct = await this.prisma.quotationProduct.create({
            data: {
              quotationId: quotation.id,
              productId: product.id,
              quantity: parseInt(item.Quantidade),
              totalValue: itemTotalValue,
              finalValue: itemTotalValue,
              description: item.ObservacaoItem || product.name,
              technicalDescription: product.technicalDescription,
            },
          });

          // Criar QuotationProductItem para cada ProductItem
          if (product.items && product.items.length > 0) {
            const productItem = product.items[0]; // Usar o primeiro item como padrão

            await this.prisma.quotationProductItem.create({
              data: {
                quotationId: quotation.id,
                productId: product.id,
                quotationProductId: quotationProduct.id,
                productItemId: productItem.id,
                quantity: parseInt(item.Quantidade),
                name: productItem.name,
                salePrice: parseFloat(item.ValorUnitario),
                unitCost: productItem.unitCost,
                totalValue: itemTotalValue,
                width: productItem.width,
                height: productItem.height,
                unitKind: productItem.unitKind,
              },
            });
          }
        }

        // Atualizar total do orçamento
        await this.prisma.quotation.update({
          where: { id: quotation.id },
          data: { totalValue: quotationTotalValue },
        });

        successCount++;
      } catch (error) {
        failedCount++;
        const firstRowNumber = items[0].rowNumber;
        errors.push({
          row: firstRowNumber,
          error: `Orçamento ${key}: ${error.message}`,
        });
      }
    }

    return { successCount, failedCount, errors };
  }

  /**
   * Importar ordens de serviço (múltiplas linhas por ordem)
   */
  private async importOrders(rows: any[], companyId: string) {
    let successCount = 0;
    let failedCount = 0;
    const errors: any[] = [];

    // Agrupar linhas por NumeroVenda-Serie
    const ordersMap = new Map<string, any[]>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = `${row.NumeroVenda}-${row.Serie}`;

      if (!ordersMap.has(key)) {
        ordersMap.set(key, []);
      }

      ordersMap.get(key)!.push({
        ...row,
        rowNumber: i + 2, // Linha no CSV (considerando header)
      });
    }

    // Processar cada ordem
    for (const [key, items] of ordersMap) {
      try {
        const firstItem = items[0];

        // Buscar série
        const series = await this.prisma.saleSeries.findFirst({
          where: {
            code: firstItem.Serie,
            companyId,
            isActive: true,
          },
        });

        if (!series) {
          throw new Error(`Série '${firstItem.Serie}' não encontrada`);
        }

        // Buscar cliente por CPF/CNPJ
        const cleanCpfCnpj = firstItem.ClienteCpfCnpj.replace(/[^\d]/g, '');
        const client = await this.prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
            ],
          },
        });

        if (!client) {
          throw new Error(
            `Cliente com CPF/CNPJ '${firstItem.ClienteCpfCnpj}' não encontrado`,
          );
        }

        // Buscar vendedor
        const employee = await this.prisma.employee.findFirst({
          where: {
            user: {
              email: firstItem.VendedorEmail,
            },
            companyId,
            isActive: true,
          },
          include: {
            user: true,
          },
        });

        if (!employee) {
          throw new Error(
            `Vendedor com email '${firstItem.VendedorEmail}' não encontrado`,
          );
        }

        // Validar status da ordem
        let orderStatus: 'IN_PRODUCTION' | 'FINISHED' | 'CANCELED' =
          'IN_PRODUCTION';
        if (firstItem.StatusOrdem) {
          const validStatuses = ['IN_PRODUCTION', 'FINISHED', 'CANCELED'];
          if (validStatuses.includes(firstItem.StatusOrdem)) {
            orderStatus = firstItem.StatusOrdem as
              | 'IN_PRODUCTION'
              | 'FINISHED'
              | 'CANCELED';
          }
        }

        // Criar orçamento primeiro (pois Order depende de Quotation)
        const quotation = await this.prisma.quotation.create({
          data: {
            quotationNumber: parseInt(firstItem.NumeroVenda),
            seriesId: series.id,
            status: 'DONE', // Orçamento já aprovado vira ordem
            createdAt: firstItem.DataVenda
              ? new Date(firstItem.DataVenda)
              : new Date(),
            dueDate: firstItem.DataValidade
              ? new Date(firstItem.DataValidade)
              : null,
            clientId: client.id,
            sellerId: employee.id,
            companyId,
            totalValue: 0, // Será calculado depois
          },
        });

        let quotationTotalValue = 0;

        // Criar produtos do orçamento
        for (const item of items) {
          // Buscar produto
          const product = await this.prisma.product.findUnique({
            where: {
              code_companyId: {
                code: item.ProdutoCodigo,
                companyId,
              },
            },
            include: {
              items: true,
            },
          });

          if (!product) {
            throw new Error(
              `Produto com código '${item.ProdutoCodigo}' não encontrado`,
            );
          }

          const quantity = parseFloat(item.Quantidade) || 0;
          const unitValue = parseFloat(item.ValorUnitario) || 0;
          const itemTotalValue = parseFloat(item.ValorTotal) || 0;
          const discount = parseFloat(item.Desconto) || 0;

          quotationTotalValue += itemTotalValue;

          // Criar produto do orçamento
          const quotationProduct = await this.prisma.quotationProduct.create({
            data: {
              quotationId: quotation.id,
              productId: product.id,
              description: item.ProdutoNome || product.name,
              quantity,
              totalValue: itemTotalValue,
              discount,
              notes: item.ObservacaoItem || null,
            },
          });

          // Criar itens do produto (se o produto tiver items)
          for (const productItem of product.items) {
            await this.prisma.quotationProductItem.create({
              data: {
                quotationProductId: quotationProduct.id,
                quotationId: quotation.id,
                productId: product.id,
                productItemId: productItem.id,
                name: productItem.name,
                quantity,
                unitCost: productItem.unitCost,
                salePrice: productItem.salePrice,
                totalValue: (productItem.salePrice || 0) * quantity,
                width: productItem.width,
                height: productItem.height,
                length: productItem.length,
                weight: productItem.weight,
                volume: productItem.volume,
                distance: productItem.distance,
                duration: productItem.duration,
              },
            });
          }
        }

        // Atualizar total do orçamento
        await this.prisma.quotation.update({
          where: { id: quotation.id },
          data: { totalValue: quotationTotalValue },
        });

        // Criar ordem de serviço vinculada ao orçamento
        await this.prisma.order.create({
          data: {
            quotationId: quotation.id,
            status: orderStatus,
            deliveredAt:
              firstItem.DataEntrega && orderStatus === 'FINISHED'
                ? new Date(firstItem.DataEntrega)
                : null,
          },
        });

        successCount++;
      } catch (error) {
        failedCount++;
        const firstRowNumber = items[0].rowNumber;
        errors.push({
          row: firstRowNumber,
          error: `Ordem ${key}: ${error.message}`,
        });
      }
    }

    return { successCount, failedCount, errors };
  }

  /**
   * Importar lançamentos financeiros (múltiplas parcelas por lançamento)
   */
  private async importFinancial(rows: any[], companyId: string) {
    let successCount = 0;
    let failedCount = 0;
    const errors: any[] = [];

    // Agrupar linhas por Tipo-Descricao-DataReferencia
    const financialMap = new Map<string, any[]>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = `${row.Tipo}-${row.Descricao}-${row.DataReferencia}`;

      if (!financialMap.has(key)) {
        financialMap.set(key, []);
      }

      financialMap.get(key)!.push({
        ...row,
        rowNumber: i + 2, // Linha no CSV (considerando header)
      });
    }

    // Processar cada lançamento
    for (const [key, installments] of financialMap) {
      try {
        const firstItem = installments[0];
        const isReceivable = firstItem.Tipo.toUpperCase() === 'RECEITA';

        // Buscar cliente (se for receita)
        let clientId: string | null = null;
        if (isReceivable && firstItem.ClienteCpfCnpj) {
          const cleanCpfCnpj = firstItem.ClienteCpfCnpj.replace(/[^\d]/g, '');
          const client = await this.prisma.client.findFirst({
            where: {
              companyId,
              OR: [
                { cpf: { contains: cleanCpfCnpj } },
                { cnpj: { contains: cleanCpfCnpj } },
              ],
            },
          });
          if (!client) {
            throw new Error(
              `Cliente com CPF/CNPJ '${firstItem.ClienteCpfCnpj}' não encontrado`,
            );
          }
          clientId = client.id;
        }

        // Buscar fornecedor (se for despesa)
        let supplierId: string | null = null;
        if (!isReceivable && firstItem.FornecedorCpfCnpj) {
          const cleanCpfCnpj = firstItem.FornecedorCpfCnpj.replace(
            /[^\d]/g,
            '',
          );
          const supplier = await this.prisma.supplier.findFirst({
            where: {
              companyId,
              OR: [
                { cpf: { contains: cleanCpfCnpj } },
                { cnpj: { contains: cleanCpfCnpj } },
              ],
            },
          });
          if (!supplier) {
            throw new Error(
              `Fornecedor com CPF/CNPJ '${firstItem.FornecedorCpfCnpj}' não encontrado`,
            );
          }
          supplierId = supplier.id;
        }

        // Buscar natureza
        let natureId: string | null = null;
        if (firstItem.Natureza) {
          const nature = await this.prisma.nature.findFirst({
            where: {
              description: firstItem.Natureza,
              companyId,
              isActive: true,
            },
          });
          if (!nature) {
            throw new Error(`Natureza '${firstItem.Natureza}' não encontrada`);
          }
          natureId = nature.id;
        }

        // Buscar subcategoria
        let subCategoryId: string | null = null;
        if (firstItem.SubCategoria) {
          const subCategory = await this.prisma.subCategory.findFirst({
            where: {
              description: firstItem.SubCategoria,
              companyId,
              isActive: true,
            },
          });
          if (!subCategory) {
            throw new Error(
              `Subcategoria '${firstItem.SubCategoria}' não encontrada`,
            );
          }
          subCategoryId = subCategory.id;
        }

        const totalAmount = parseFloat(firstItem.ValorTotal) || 0;
        const referenceDate = firstItem.DataReferencia
          ? new Date(firstItem.DataReferencia)
          : new Date();

        if (isReceivable) {
          // Criar conta a receber (Receivable)
          const receivable = await this.prisma.receivable.create({
            data: {
              description: firstItem.Descricao,
              reference: firstItem.Referencia || null,
              referenceDate,
              totalAmount,
              totalValue: totalAmount,
              companyId,
              clientId,
              natureId,
              subCategoryId,
              notes: firstItem.Observacoes || null,
              status: 'PENDING', // Será atualizado se houver parcelas pagas
              installmentQty: installments.length,
            },
          });

          // Criar parcelas
          for (const item of installments) {
            const installmentAmount = parseFloat(item.ValorParcela) || 0;
            const dueDate = item.DataVencimento
              ? new Date(item.DataVencimento)
              : new Date();

            // Validar status
            let status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED' = 'PENDING';
            if (item.Status) {
              const validStatuses = ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'];
              if (validStatuses.includes(item.Status.toUpperCase())) {
                status = item.Status.toUpperCase() as
                  | 'PENDING'
                  | 'PAID'
                  | 'OVERDUE'
                  | 'CANCELED';
              }
            }

            // Buscar condição de pagamento
            let paymentConditionId: string | null = null;
            if (item.CondicaoPagamento) {
              const paymentCondition =
                await this.prisma.paymentCondition.findFirst({
                  where: {
                    name: item.CondicaoPagamento,
                    companyId,
                    isActive: true,
                  },
                });
              if (paymentCondition) {
                paymentConditionId = paymentCondition.id;
              }
            }

            // Buscar conta bancária
            let bankAccountId: string | null = null;
            if (item.ContaBancaria) {
              const bankAccount = await this.prisma.bankAccount.findFirst({
                where: {
                  name: item.ContaBancaria,
                  companyId,
                  isActive: true,
                },
              });
              if (bankAccount) {
                bankAccountId = bankAccount.id;
              }
            }

            await this.prisma.receivableInstallment.create({
              data: {
                receivableId: receivable.id,
                installmentNumber: parseInt(item.Parcela) || 1,
                dueDate,
                amount: installmentAmount,
                status,
                paidDate:
                  status === 'PAID' && item.DataPagamento
                    ? new Date(item.DataPagamento)
                    : null,
                paidAmount:
                  status === 'PAID' && item.ValorPago
                    ? parseFloat(item.ValorPago)
                    : null,
                paymentConditionId,
                bankAccountId,
              },
            });
          }

          // Atualizar status da receivable baseado nas parcelas
          const allPaid = installments.every(
            (item) => item.Status?.toUpperCase() === 'PAID',
          );
          if (allPaid) {
            await this.prisma.receivable.update({
              where: { id: receivable.id },
              data: { status: 'PAID' },
            });
          }
        } else {
          // Criar conta a pagar (Payable)
          const payable = await this.prisma.payable.create({
            data: {
              description: firstItem.Descricao,
              reference: firstItem.Referencia || null,
              referenceDate,
              totalAmount,
              totalValue: totalAmount,
              companyId,
              supplierId,
              natureId,
              subCategoryId,
              notes: firstItem.Observacoes || null,
              status: 'PENDING', // Será atualizado se houver parcelas pagas
              installmentQty: installments.length,
            },
          });

          // Criar parcelas
          for (const item of installments) {
            const installmentAmount = parseFloat(item.ValorParcela) || 0;
            const dueDate = item.DataVencimento
              ? new Date(item.DataVencimento)
              : new Date();

            // Validar status
            let status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED' = 'PENDING';
            if (item.Status) {
              const validStatuses = ['PENDING', 'PAID', 'OVERDUE', 'CANCELED'];
              if (validStatuses.includes(item.Status.toUpperCase())) {
                status = item.Status.toUpperCase() as
                  | 'PENDING'
                  | 'PAID'
                  | 'OVERDUE'
                  | 'CANCELED';
              }
            }

            // Buscar condição de pagamento
            let paymentConditionId: string | null = null;
            if (item.CondicaoPagamento) {
              const paymentCondition =
                await this.prisma.paymentCondition.findFirst({
                  where: {
                    name: item.CondicaoPagamento,
                    companyId,
                    isActive: true,
                  },
                });
              if (paymentCondition) {
                paymentConditionId = paymentCondition.id;
              }
            }

            // Buscar conta bancária
            let bankAccountId: string | null = null;
            if (item.ContaBancaria) {
              const bankAccount = await this.prisma.bankAccount.findFirst({
                where: {
                  name: item.ContaBancaria,
                  companyId,
                  isActive: true,
                },
              });
              if (bankAccount) {
                bankAccountId = bankAccount.id;
              }
            }

            await this.prisma.payableInstallment.create({
              data: {
                payableId: payable.id,
                installmentNumber: parseInt(item.Parcela) || 1,
                dueDate,
                amount: installmentAmount,
                status,
                paidDate:
                  status === 'PAID' && item.DataPagamento
                    ? new Date(item.DataPagamento)
                    : null,
                paidAmount:
                  status === 'PAID' && item.ValorPago
                    ? parseFloat(item.ValorPago)
                    : null,
                paymentConditionId,
                bankAccountId,
              },
            });
          }

          // Atualizar status da payable baseado nas parcelas
          const allPaid = installments.every(
            (item) => item.Status?.toUpperCase() === 'PAID',
          );
          if (allPaid) {
            await this.prisma.payable.update({
              where: { id: payable.id },
              data: { status: 'PAID' },
            });
          }
        }

        successCount++;
      } catch (error) {
        failedCount++;
        const firstRowNumber = installments[0].rowNumber;
        errors.push({
          row: firstRowNumber,
          error: `Lançamento ${key}: ${error.message}`,
        });
      }
    }

    return { successCount, failedCount, errors };
  }

  /**
   * Listar importações de uma empresa
   */
  async listImports(companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [imports, total] = await Promise.all([
      this.prisma.importLog.findMany({
        where: { companyId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.importLog.count({
        where: { companyId },
      }),
    ]);

    return {
      data: imports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

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
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2;

        try {
          // Importar baseado na entidade
          if (importLog.entity === 'client') {
            await this.importClient(row, importLog.companyId);
          } else if (importLog.entity === 'product') {
            await this.importProduct(row, importLog.companyId);
          }
          // TODO: adicionar outras entidades (quotation)

          successCount++;
        } catch (error) {
          failedCount++;
          errors.push({
            row: rowNumber,
            error: error.message,
          });
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

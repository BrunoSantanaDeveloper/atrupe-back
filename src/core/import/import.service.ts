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

      // Limpar buffer da memória após processamento
      this.fileBuffers.delete(importId);

      return {
        importId,
        valid: validationResult.errors.length === 0,
        totalRows: rows.length,
        validRows: validationResult.validRows,
        errors: validationResult.errors,
        preview: rows.slice(0, 10),
      };
    } catch (error) {
      // Limpar buffer da memória em caso de erro também
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
          error: `Field '${field.name}' is required`,
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
          error: `Invalid email format`,
        });
      }

      // Validar pattern (regex)
      if (field.pattern && !field.pattern.test(value)) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: `Value does not match required pattern`,
        });
      }

      // Validar tamanho máximo
      if (field.maxLength && value.length > field.maxLength) {
        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: `Value exceeds maximum length of ${field.maxLength}`,
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

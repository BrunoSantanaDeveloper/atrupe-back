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
  SUPPLIER_IMPORT_SCHEMA,
} from './schemas';

@Injectable()
export class ImportService {
  private fileBuffers: Map<string, Buffer> = new Map();

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {}

  /**
   * Converte valor em reais para centavos (multiplica por 100)
   * Trata valores vazios, nulos e arredonda para evitar erros de ponto flutuante
   */
  private toCents(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return null;
    return Math.round(numValue * 100);
  }

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
    const allowedEntities = [
      'client',
      'product',
      'quotation',
      'supplier',
      'financial',
      'order',
    ];
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
      // Detectar encoding: tentar UTF-8, se contiver caracteres inválidos, usar Latin-1
      let content = buffer.toString('utf-8');
      if (content.includes('\uFFFD')) {
        // Buffer contém bytes inválidos em UTF-8 — provavelmente Latin-1/Windows-1252
        content = buffer.toString('latin1');
      }

      // Remover BOM se presente
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }

      // Auto detect delimiter based on the first line
      const headLine = content.split('\n')[0] || '';
      const commaCount = (headLine.match(/,/g) || []).length;
      const semicolonCount = (headLine.match(/;/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ';' : ',';

      const rows: any[] = [];
      const stream = Readable.from(content);

      stream
        .pipe(
          csv.parse({
            headers: true,
            trim: true,
            delimiter,
            discardUnmappedColumns: true, // Ignore extra columns that don't have a header
          }),
        )
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
      supplier: SUPPLIER_IMPORT_SCHEMA,
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
        const customError = await field.validate(
          value,
          companyId,
          this.prisma,
          row,
        );
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
            } else if (importLog.entity === 'supplier') {
              await this.importSupplier(row, importLog.companyId);
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
    let type = row.tipo?.toUpperCase();
    if (type === 'F' || type === 'PESSOA') type = 'PERSON';
    if (type === 'J' || type === 'EMPRESA') type = 'COMPANY';

    // Buscar ou criar categoria/grupo
    let categoryId = null;
    if (row.grupo && row.grupo.trim() !== '') {
      let category = await this.prisma.category.findFirst({
        where: { name: row.grupo, companyId, kind: 'CLIENT' },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: { name: row.grupo, companyId, kind: 'CLIENT' },
        });
      }
      categoryId = category.id;
    }

    // Converter data de nascimento
    let birthdate = null;
    if (row.dataNascimento && row.dataNascimento.trim() !== '') {
      birthdate = this.parseDateString(row.dataNascimento);
    }

    // Converter filial (boolean)
    let isBranch = false;
    if (row.filial) {
      const v = row.filial.toUpperCase();
      isBranch = ['SIM', 'S', 'TRUE', '1', 'YES'].includes(v);
    }

    // Determinar status: ACTIVE se tiver nome + CPF/CNPJ + endereço completo + telefone
    const hasCpfCnpj = !!(row.cpf || row.cnpj);
    const hasFullAddress = !!(
      row.cep &&
      row.uf &&
      row.cidade &&
      row.bairro &&
      row.rua
    );
    const hasPhone = !!(row.telefone || row.celular);
    const status =
      hasCpfCnpj && hasFullAddress && hasPhone ? 'ACTIVE' : 'PROSPECT';

    // Normalizar CPF/CNPJ (remover pontuação e completar zeros à esquerda)
    let cpfNormalized: string | null = null;
    if (row.cpf) {
      let cpfClean = row.cpf.replace(/\D/g, '');
      if (cpfClean.length < 11 && cpfClean.length >= 9) {
        cpfClean = cpfClean.padStart(11, '0');
      }
      cpfNormalized = cpfClean;
    }

    let cnpjNormalized: string | null = null;
    if (row.cnpj) {
      let cnpjClean = row.cnpj.replace(/\D/g, '');
      if (cnpjClean.length < 14 && cnpjClean.length >= 12) {
        cnpjClean = cnpjClean.padStart(14, '0');
      }
      cnpjNormalized = cnpjClean;
    }

    // Criar cliente
    await this.prisma.client.create({
      data: {
        companyId,
        type: type || 'PERSON',
        name: row.nome,
        email: row.email || null,
        cpf: cpfNormalized,
        cnpj: cnpjNormalized,
        rg: row.rg || null,
        phone: row.telefone || null,
        mobile: row.celular || null,
        categoryId,
        birthdate,
        isBranch,
        corporateName: row.razaoSocial || null,
        notes: row.observacoes || null,
        status,
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
        contacts:
          row.responsavelNome && row.responsavelNome.trim() !== ''
            ? {
                create: [
                  {
                    name: row.responsavelNome,
                    email: row.responsavelEmail || null,
                    phone: row.responsavelTelefone || null,
                    mobile: row.responsavelCelular || null,
                  },
                ],
              }
            : undefined,
        isImported: true,
      },
    });
  }

  /**
   * Parse date string in DD/MM/YYYY or YYYY-MM-DD format
   */
  private parseDateString(dateStr: string): Date | null {
    if (!dateStr) return null;

    // Try DD/MM/YYYY format
    const brFormat = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const brMatch = dateStr.match(brFormat);
    if (brMatch) {
      const [, day, month, year] = brMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // Try YYYY-MM-DD format
    const isoFormat = /^(\d{4})-(\d{2})-(\d{2})$/;
    const isoMatch = dateStr.match(isoFormat);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    return null;
  }

  /**
   * Importar um fornecedor do CSV
   */
  private async importSupplier(row: any, companyId: string): Promise<void> {
    // Normalizar tipo
    let type = row.tipo?.toUpperCase();
    if (type === 'F' || type === 'PESSOA') type = 'PERSON';
    if (type === 'J' || type === 'EMPRESA') type = 'COMPANY';

    // Buscar ou criar categoria
    let categoryId = null;
    if (row.categoria && row.categoria.trim() !== '') {
      let category = await this.prisma.category.findFirst({
        where: { name: row.categoria, companyId, kind: 'SUPPLIER' },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: { name: row.categoria, companyId, kind: 'SUPPLIER' },
        });
      }
      categoryId = category.id;
    }

    // Converter filial (boolean)
    let isBranch = false;
    if (row.filial) {
      const v = row.filial.toUpperCase();
      isBranch = ['SIM', 'S', 'TRUE', '1', 'YES'].includes(v);
    }

    // Normalizar CPF/CNPJ (remover pontuação e completar zeros à esquerda)
    let cpfNormalized: string | null = null;
    if (row.cpf) {
      let cpfClean = row.cpf.replace(/\D/g, '');
      if (cpfClean.length < 11 && cpfClean.length >= 9) {
        cpfClean = cpfClean.padStart(11, '0');
      }
      cpfNormalized = cpfClean;
    }

    let cnpjNormalized: string | null = null;
    if (row.cnpj) {
      let cnpjClean = row.cnpj.replace(/\D/g, '');
      if (cnpjClean.length < 14 && cnpjClean.length >= 12) {
        cnpjClean = cnpjClean.padStart(14, '0');
      }
      cnpjNormalized = cnpjClean;
    }

    // Criar fornecedor
    await this.prisma.supplier.create({
      data: {
        companyId,
        type: type || 'COMPANY',
        name: row.nome,
        email: row.email || null,
        cpf: cpfNormalized,
        cnpj: cnpjNormalized,
        rg: row.rg || null,
        phone: row.telefone || null,
        mobile: row.celular || null,
        corporateName: row.razaoSocial || null,
        notes: row.observacoes || null,
        categoryId,
        isBranch,
        isImported: true,
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
        contacts:
          row.responsavelNome && row.responsavelNome.trim() !== ''
            ? {
                create: [
                  {
                    name: row.responsavelNome,
                    email: row.responsavelEmail || null,
                    phone: row.responsavelTelefone || null,
                    mobile: row.responsavelCelular || null,
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
    // Buscar setor por nome case-insensitive (já validado, então deve existir)
    let sector = await this.prisma.companySector.findFirst({
      where: {
        name: { equals: row.setor, mode: 'insensitive' },
        companyId,
      },
    });
    // Fallback: busca sem acentos (ex: "Impressao" → "Impressão")
    if (!sector) {
      const normalize = (s: string) =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();
      const sectors = await this.prisma.companySector.findMany({
        where: { companyId },
      });
      sector =
        sectors.find((s: any) => normalize(s.name) === normalize(row.setor)) ||
        null;
    }

    // Buscar ou criar categoria por nome (campo "grupo" do CSV) vinculado ao setor
    let category = null;
    if (row.grupo && row.grupo.trim() !== '') {
      category = await this.prisma.category.findFirst({
        where: { name: row.grupo, companyId, kind: 'PRODUCT' },
      });

      if (!category) {
        category = await this.prisma.category.create({
          data: {
            name: row.grupo,
            companyId,
            kind: 'PRODUCT',
            sectorId: sector ? sector.id : null,
          },
        });
      } else if (!category.sectorId && sector) {
        // Atualiza a categoria com o setor se ela já existir, mas sem setor
        category = await this.prisma.category.update({
          where: { id: category.id },
          data: { sectorId: sector.id },
        });
      }
    }

    // Se grupo não foi informado, usar o primeiro grupo do setor
    if (!category && sector) {
      category = await this.prisma.category.findFirst({
        where: { companyId, kind: 'PRODUCT', sectorId: sector.id },
        orderBy: { name: 'asc' },
      });

      // Fallback: usar primeiro grupo da empresa caso o setor não tenha
      if (!category) {
        category = await this.prisma.category.findFirst({
          where: { companyId, kind: 'PRODUCT' },
          orderBy: { name: 'asc' },
        });
      }

      // Se não existe nenhum grupo, criar um padrão
      if (!category) {
        category = await this.prisma.category.create({
          data: {
            name: 'Geral',
            companyId,
            kind: 'PRODUCT',
            sectorId: sector.id,
          },
        });
      }
    }

    // Converter campos de permissão
    const allowEditValues = row.permitirEditarValor
      ? ['SIM', 'S', 'TRUE', '1', 'YES'].includes(
          row.permitirEditarValor.toUpperCase(),
        )
      : true;
    const allowEditDescription = row.permitirEditarDescricao
      ? ['SIM', 'S', 'TRUE', '1', 'YES'].includes(
          row.permitirEditarDescricao.toUpperCase(),
        )
      : true;

    // Verificar se produto já existe (case-insensitive)
    const existingProduct = await this.prisma.product.findFirst({
      where: {
        code: { equals: row.codigo, mode: 'insensitive' },
        companyId,
      },
    });

    let product = existingProduct;
    if (!product) {
      // Criar produto se não existir
      product = await this.prisma.product.create({
        data: {
          companyId,
          code: row.codigo,
          name: row.nome,
          technicalDescription: row.descricao || null,
          categoryId: category.id,
          sectorId: sector.id,
          isActive: true,
          status: 'ACTIVE',
          isImported: true,
          allowEditValues,
          allowEditDescription,
        },
      });
    }

    // Criar item do produto (sempre criamos pelo menos 1 item para o produto importado)
    const itemName =
      row.servico && row.servico.trim() !== '' ? row.servico : row.nome;

    // Buscar unidade de medida
    let unitOfMeasureId = null;
    let unitKind = null;
    if (row.unidadeMedida) {
      const uomCode = row.unidadeMedida.toUpperCase().trim();
      const unitOfMeasure = await this.prisma.defaultUnitOfMeasure.findFirst({
        where: {
          code: uomCode,
        },
      });
      unitOfMeasureId = unitOfMeasure?.id || null;
      unitKind = unitOfMeasure?.kind || null;

      // Se a unidade de medida não foi encontrada no banco ou não tem kind, inferimos pelo código
      if (!unitKind) {
        if (['M2', 'M²', 'MT2', 'METRO QUADRADO'].includes(uomCode)) {
          unitKind = 'AREA';
        } else if (['M', 'ML', 'METRO', 'METRO LINEAR'].includes(uomCode)) {
          unitKind = 'LENGTH';
        } else if (['KG', 'QUILO', 'KILO', 'QUILOGRAMA'].includes(uomCode)) {
          unitKind = 'WEIGHT';
        } else if (['L', 'LT', 'LITRO', 'LITROS'].includes(uomCode)) {
          unitKind = 'CAPACITY';
        } else if (['KM', 'QUILOMETRO'].includes(uomCode)) {
          unitKind = 'DISTANCE';
        } else if (['H', 'HR', 'HORA', 'HORAS'].includes(uomCode)) {
          unitKind = 'DURATION';
        } else {
          // Fallback comum: UN, PC, PECA, etc.
          unitKind = 'UNITY';
        }
      }
    }

    // Converter valor de unidade de exibição (ex: R$/m²) para unidade bruta (ex: R$/mm²)
    // O frontend faz a conversão inversa (raw → display) ao exibir
    const convertDisplayToRaw = (
      valueInCents: number | null,
      kind: string | null,
    ): number | null => {
      if (valueInCents === null || valueInCents === 0) return valueInCents;
      switch (kind) {
        case 'AREA':
          return valueInCents / 1_000_000; // R$/m² → R$/mm²
        case 'LENGTH':
          return valueInCents / 1_000; // R$/metro → R$/mm
        case 'CAPACITY':
          return valueInCents / 1_000; // R$/litro → R$/ml
        case 'WEIGHT':
          return valueInCents / 1_000_000; // R$/kg → R$/mg
        case 'DISTANCE':
          return valueInCents / 1_000; // R$/km → R$/metro
        case 'DURATION':
          return valueInCents / 3_600; // R$/hora → R$/segundo
        case 'UNITY':
        default:
          return valueInCents;
      }
    };

    // O CSV traz valores em unidade de exibição (ex: R$ 390,00 por m²)
    // "preco" = preço de venda por unidade de exibição → mapeia para unitCost (valor que o frontend mostra como "Valor de venda m²")
    // "custo" = custo interno por unidade → armazenado como unitCost se preco não for informado
    const precoInCents = this.toCents(row.preco);
    const custoInCents = this.toCents(row.custo);

    // Usar preco como unitCost principal; se vazio/zero, usar custo como fallback
    const displayUnitCost =
      precoInCents && precoInCents > 0
        ? precoInCents
        : custoInCents && custoInCents > 0
          ? custoInCents
          : null;

    const rawUnitCost = convertDisplayToRaw(displayUnitCost, unitKind);

    // salePrice = total (unitCost × totalQuantity). Sem dimensões, será recalculado pelo frontend.
    // Se houver dimensões (largura × altura para AREA), calculamos aqui
    let salePrice: number | null = null;

    // O banco salva dimensões em milímetros. O CSV geralmente traz em metros (ex: 1,40).
    const parseDimension = (val: string | undefined): number | null => {
      if (!val) return null;
      const parsed = parseFloat(val.replace(',', '.'));
      return isNaN(parsed) ? null : parsed * 1000;
    };

    const widthMm = parseDimension(row.largura);
    const heightMm = parseDimension(row.altura);

    if (rawUnitCost && rawUnitCost > 0) {
      if (unitKind === 'AREA' && widthMm && heightMm) {
        salePrice = rawUnitCost * widthMm * heightMm;
      } else if (unitKind === 'UNITY') {
        salePrice = rawUnitCost;
      }
    }

    // Buscar item existente do produto (para evitar duplicação em re-importação)
    const existingItem = await this.prisma.productItem.findFirst({
      where: {
        productId: product.id,
        name: itemName,
      },
    });

    if (existingItem) {
      await this.prisma.productItem.update({
        where: { id: existingItem.id },
        data: {
          width: widthMm,
          height: heightMm,
          unitCost: rawUnitCost,
          salePrice: salePrice,
          defaultUnitOfMeasureId: unitOfMeasureId,
          unitKind: unitKind,
        },
      });
    } else {
      await this.prisma.productItem.create({
        data: {
          productId: product.id,
          name: itemName,

          width: widthMm,
          height: heightMm,
          unitCost: rawUnitCost,
          salePrice: salePrice,
          defaultUnitOfMeasureId: unitOfMeasureId,
          unitKind: unitKind,
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
        let client = await this.prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
              { cpf: firstItem.ClienteCpfCnpj },
              { cnpj: firstItem.ClienteCpfCnpj },
            ],
          },
        });

        // Se não encontrou, tentar busca mais flexível
        if (!client) {
          const clients = await this.prisma.client.findMany({
            where: { companyId },
          });
          client =
            clients.find((c: any) => {
              const cleanCpf = (c.cpf || '').replace(/[^\d]/g, '');
              const cleanCnpj = (c.cnpj || '').replace(/[^\d]/g, '');
              return cleanCpf === cleanCpfCnpj || cleanCnpj === cleanCpfCnpj;
            }) || null;
        }

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
        let status:
          | 'OPEN'
          | 'APPROVED'
          | 'DONE'
          | 'REJECTED'
          | 'CANCELED'
          | 'OVERDUE' = 'OPEN';
        const statusUpper = (firstItem.Status || 'OPEN').toUpperCase();

        if (statusUpper === 'APPROVED' || statusUpper === 'APROVADO') {
          status = 'APPROVED';
        } else if (statusUpper === 'DONE' || statusUpper === 'CONCLUIDO') {
          status = 'DONE';
        } else if (statusUpper === 'REJECTED' || statusUpper === 'REJEITADO') {
          status = 'REJECTED';
        } else if (statusUpper === 'CANCELED' || statusUpper === 'CANCELADO') {
          status = 'CANCELED';
        } else if (statusUpper === 'OVERDUE' || statusUpper === 'VENCIDO') {
          status = 'OVERDUE';
        }

        // Buscar contato/responsável se informado (por nome ou email)
        let contactId = null;
        if (
          firstItem.ResponsavelNome &&
          firstItem.ResponsavelNome.trim() !== ''
        ) {
          // Buscar por nome
          const contact = await this.prisma.contact.findFirst({
            where: {
              name: firstItem.ResponsavelNome,
              clientId: client.id,
            },
          });
          contactId = contact?.id || null;
        }
        // Se não encontrar por nome, tentar por email
        if (
          !contactId &&
          firstItem.ResponsavelEmail &&
          firstItem.ResponsavelEmail.trim() !== ''
        ) {
          const contact = await this.prisma.contact.findFirst({
            where: {
              email: firstItem.ResponsavelEmail,
              clientId: client.id,
            },
          });
          contactId = contact?.id || null;
        }

        // Criar orçamento
        const quotation = await this.prisma.quotation.create({
          data: {
            companyId,
            seriesId: series.id,
            clientId: client.id,
            sellerId: seller.id,
            contactId,
            status,
            description: firstItem.ObservacaoItem || null,
            dueDate: firstItem.DataValidade
              ? new Date(firstItem.DataValidade)
              : null,
            quotationNumber: parseInt(firstItem.NumeroVenda),
            totalValue: 0, // Será calculado depois
            isImported: true,
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

          const itemTotalValue = this.toCents(item.ValorTotal) || 0;
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
                salePrice: this.toCents(item.ValorUnitario),
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

        // === CRIAR DELIVERY INFO ===
        const tipoEntrega = firstItem.TipoEntrega || 'PICKUP';
        const freteCusto = this.toCents(firstItem.FreteCusto);
        const freteValor = this.toCents(firstItem.FreteValor);

        // Buscar transportador se informado
        let transportadorId = null;
        if (
          firstItem.TransportadorCpfCnpj &&
          firstItem.TransportadorCpfCnpj.trim() !== ''
        ) {
          const cleanTransportador = firstItem.TransportadorCpfCnpj.replace(
            /[^\d]/g,
            '',
          );
          const transportador = await this.prisma.supplier.findFirst({
            where: {
              companyId,
              OR: [
                { cpf: { contains: cleanTransportador } },
                { cnpj: { contains: cleanTransportador } },
              ],
            },
          });
          transportadorId = transportador?.id || null;
        }

        await this.prisma.deliveryInfo.create({
          data: {
            quotationId: quotation.id,
            deliveryType: tipoEntrega === 'CARRIER' ? 'CARRIER' : 'PICKUP',
            cost: freteCusto,
            value: freteValor,
            supplierId: transportadorId,
            estimatedDate: firstItem.DataEntrega
              ? new Date(firstItem.DataEntrega)
              : null,
          },
        });

        // === CRIAR QUOTATION PAYMENT E PARCELAS ===
        let paymentCondition = null;
        if (firstItem.CondicaoPagamento) {
          paymentCondition = await this.prisma.paymentCondition.findFirst({
            where: {
              name: firstItem.CondicaoPagamento,
              companyId,
              isActive: true,
            },
          });
        }

        // Fallback: buscar primeira condição de pagamento ativa
        if (!paymentCondition) {
          paymentCondition = await this.prisma.paymentCondition.findFirst({
            where: {
              companyId,
              isActive: true,
            },
          });
        }

        if (paymentCondition) {
          const entradaValor = this.toCents(firstItem.EntradaValor) || 0;
          const qtdParcelas = parseInt(firstItem.QtdParcelas) || 1;

          const quotationPayment = await this.prisma.quotationPayment.create({
            data: {
              quotationId: quotation.id,
              paymentConditionId: paymentCondition.id,
              totalValue: quotationTotalValue,
              finalValue: quotationTotalValue,
              billing: 'ON_ORDER',
              downPayment: entradaValor,
              downPaymentDueDate: firstItem.EntradaVencimento
                ? new Date(firstItem.EntradaVencimento)
                : null,
              downPaymentConditionId:
                entradaValor > 0 ? paymentCondition.id : null,
              installmentQty: qtdParcelas,
            },
          });

          // Criar parcelas do QuotationInstallment
          const parcelas = [];
          for (let i = 1; i <= 3; i++) {
            const valor = this.toCents(firstItem[`Parcela${i}Valor`]);
            const vencimento = firstItem[`Parcela${i}Vencimento`];
            if (valor && valor > 0 && vencimento) {
              parcelas.push({
                quotationPaymentId: quotationPayment.id,
                paymentConditionId: paymentCondition.id,
                value: valor,
                dueDate: new Date(vencimento),
              });
            }
          }

          // Se não há parcelas informadas, criar uma parcela única
          if (parcelas.length === 0 && quotationTotalValue > entradaValor) {
            const valorParcela = quotationTotalValue - entradaValor;
            const vencimentoPadrao = new Date();
            vencimentoPadrao.setDate(vencimentoPadrao.getDate() + 30);
            parcelas.push({
              quotationPaymentId: quotationPayment.id,
              paymentConditionId: paymentCondition.id,
              value: valorParcela,
              dueDate: vencimentoPadrao,
            });
          }

          if (parcelas.length > 0) {
            await this.prisma.quotationInstallment.createMany({
              data: parcelas,
            });
          }
        }

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
   * Inclui criação de lançamentos financeiros (receitas e despesas)
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
        let client = await this.prisma.client.findFirst({
          where: {
            companyId,
            OR: [
              { cpf: { contains: cleanCpfCnpj } },
              { cnpj: { contains: cleanCpfCnpj } },
              { cpf: firstItem.ClienteCpfCnpj },
              { cnpj: firstItem.ClienteCpfCnpj },
            ],
          },
        });

        // Se não encontrou, tentar busca mais flexível
        if (!client) {
          const clients = await this.prisma.client.findMany({
            where: { companyId },
          });
          client =
            clients.find((c: any) => {
              const cleanCpf = (c.cpf || '').replace(/[^\d]/g, '');
              const cleanCnpj = (c.cnpj || '').replace(/[^\d]/g, '');
              return cleanCpf === cleanCpfCnpj || cleanCnpj === cleanCpfCnpj;
            }) || null;
        }

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

        // Buscar contato/responsável se informado (por nome ou email)
        let contactId = null;
        if (
          firstItem.ResponsavelNome &&
          firstItem.ResponsavelNome.trim() !== ''
        ) {
          // Buscar por nome
          const contact = await this.prisma.contact.findFirst({
            where: {
              name: firstItem.ResponsavelNome,
              clientId: client.id,
            },
          });
          contactId = contact?.id || null;
        }
        // Se não encontrar por nome, tentar por email
        if (
          !contactId &&
          firstItem.ResponsavelEmail &&
          firstItem.ResponsavelEmail.trim() !== ''
        ) {
          const contact = await this.prisma.contact.findFirst({
            where: {
              email: firstItem.ResponsavelEmail,
              clientId: client.id,
            },
          });
          contactId = contact?.id || null;
        }

        // Criar orçamento primeiro (pois Order depende de Quotation)
        const quotation = await this.prisma.quotation.create({
          data: {
            quotationNumber: parseInt(firstItem.NumeroVenda),
            seriesId: series.id,
            status: 'APPROVED', // Orçamento aprovado que virou ordem
            approvedAt: firstItem.DataVenda
              ? new Date(firstItem.DataVenda)
              : new Date(),
            createdAt: firstItem.DataVenda
              ? new Date(firstItem.DataVenda)
              : new Date(),
            dueDate: firstItem.DataValidade
              ? new Date(firstItem.DataValidade)
              : null,
            clientId: client.id,
            sellerId: employee.id,
            contactId,
            companyId,
            totalValue: 0, // Será calculado depois
            isImported: true,
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
          const itemTotalValue = this.toCents(item.ValorTotal) || 0;
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
              finalValue: itemTotalValue - discount,
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

        // === CRIAR DELIVERY INFO ===
        const tipoEntrega = firstItem.TipoEntrega || 'PICKUP';
        await this.prisma.deliveryInfo.create({
          data: {
            quotationId: quotation.id,
            deliveryType: tipoEntrega === 'CARRIER' ? 'CARRIER' : 'PICKUP',
            cost: this.toCents(firstItem.FreteCusto),
            value: this.toCents(firstItem.FreteValor),
            estimatedDate: firstItem.DataEntrega
              ? new Date(firstItem.DataEntrega)
              : null,
          },
        });

        // === CRIAR QUOTATION PAYMENT E PARCELAS ===
        let paymentCondition = null;
        if (firstItem.CondicaoPagamento) {
          paymentCondition = await this.prisma.paymentCondition.findFirst({
            where: {
              name: firstItem.CondicaoPagamento,
              companyId,
              isActive: true,
            },
          });
        }

        // Fallback: buscar primeira condição de pagamento ativa
        if (!paymentCondition) {
          paymentCondition = await this.prisma.paymentCondition.findFirst({
            where: {
              companyId,
              isActive: true,
            },
          });
        }

        if (paymentCondition) {
          const entradaValor = this.toCents(firstItem.EntradaValor) || 0;
          const qtdParcelas = parseInt(firstItem.QtdParcelas) || 1;

          const quotationPayment = await this.prisma.quotationPayment.create({
            data: {
              quotationId: quotation.id,
              paymentConditionId: paymentCondition.id,
              totalValue: quotationTotalValue,
              finalValue: quotationTotalValue,
              billing: 'ON_ORDER',
              downPayment: entradaValor,
              downPaymentDueDate: firstItem.EntradaVencimento
                ? new Date(firstItem.EntradaVencimento)
                : null,
              downPaymentConditionId:
                entradaValor > 0 ? paymentCondition.id : null,
              installmentQty: qtdParcelas,
            },
          });

          // Criar parcelas do QuotationInstallment
          const parcelas = [];
          for (let i = 1; i <= 3; i++) {
            const valor = this.toCents(firstItem[`Parcela${i}Valor`]);
            const vencimento = firstItem[`Parcela${i}Vencimento`];
            if (valor && valor > 0 && vencimento) {
              parcelas.push({
                quotationPaymentId: quotationPayment.id,
                paymentConditionId: paymentCondition.id,
                value: valor,
                dueDate: new Date(vencimento),
              });
            }
          }

          // Se não há parcelas informadas, criar uma parcela única
          if (parcelas.length === 0 && quotationTotalValue > entradaValor) {
            const valorParcela = quotationTotalValue - entradaValor;
            const vencimentoPadrao = new Date();
            vencimentoPadrao.setDate(vencimentoPadrao.getDate() + 30);
            parcelas.push({
              quotationPaymentId: quotationPayment.id,
              paymentConditionId: paymentCondition.id,
              value: valorParcela,
              dueDate: vencimentoPadrao,
            });
          }

          if (parcelas.length > 0) {
            await this.prisma.quotationInstallment.createMany({
              data: parcelas,
            });

            // === CRIAR RECEIVABLE (RECEITA) ===
            await this.createOrderReceivable(
              quotation,
              parcelas,
              client,
              companyId,
              series,
              entradaValor,
              firstItem.EntradaVencimento,
              paymentCondition,
            );
          }
        }

        // === CRIAR PAYABLE DE FRETE ===
        const freteCusto = this.toCents(firstItem.FreteCusto) || 0;
        if (freteCusto > 0 && firstItem.FreteFornecedorCpfCnpj) {
          await this.createOrderFreightPayable(
            quotation,
            firstItem,
            companyId,
            series,
            freteCusto,
          );
        }

        // === CRIAR PAYABLE DE COMISSÃO ===
        const comissaoValor = this.toCents(firstItem.ComissaoValor) || 0;
        if (comissaoValor > 0 && firstItem.ComissaoFornecedorCpfCnpj) {
          await this.createOrderCommissionPayable(
            quotation,
            firstItem,
            companyId,
            series,
            comissaoValor,
          );
        }

        // Criar ordem de serviço vinculada ao orçamento
        await this.prisma.order.create({
          data: {
            quotationId: quotation.id,
            status: orderStatus,
            deliveredAt:
              firstItem.DataEntrega && orderStatus === 'FINISHED'
                ? new Date(firstItem.DataEntrega)
                : null,
            isImported: true,
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
   * Criar Receivable e suas parcelas a partir da ordem importada
   */
  private async createOrderReceivable(
    quotation: any,
    parcelas: any[],
    client: any,
    companyId: string,
    series: any,
    entradaValor: number,
    entradaVencimento: string,
    paymentCondition: any,
  ) {
    // Buscar natureza de vendas
    const nature = await this.prisma.nature.findFirst({
      where: {
        companyId,
        isActive: true,
        description: { equals: 'Vendas', mode: 'insensitive' },
      },
    });

    // Buscar subcategoria
    let subCategory = null;
    if (nature) {
      subCategory = await this.prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: { equals: 'Prestação de Serviços', mode: 'insensitive' },
        },
      });
    }

    // Buscar conta bancária padrão
    const defaultBankAccount = await this.prisma.bankAccount.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Criar entrada se houver
    if (entradaValor > 0) {
      const receivableDownPayment = await this.prisma.receivable.create({
        data: {
          referenceDate: quotation.createdAt,
          description: `Entrada da venda ${quotation.quotationNumber}-${series.code}`,
          totalAmount: entradaValor,
          totalValue: entradaValor,
          installmentQty: 1,
          status: 'PENDING',
          clientId: client.id,
          companyId,
          natureId: nature?.id || null,
          subCategoryId: subCategory?.id || null,
          quotationId: quotation.id,
          financialType: 'DOWN_PAYMENT',
        },
      });

      await this.prisma.receivableInstallment.create({
        data: {
          receivableId: receivableDownPayment.id,
          installmentNumber: 1,
          dueDate: entradaVencimento
            ? new Date(entradaVencimento)
            : quotation.createdAt,
          amount: entradaValor,
          paymentConditionId: paymentCondition?.id || null,
          bankAccountId: defaultBankAccount?.id || null,
          status: 'PENDING',
        },
      });
    }

    // Criar Receivable principal
    const totalAmount = parcelas.reduce((sum, p) => sum + p.value, 0);
    const firstDueDate = parcelas[0]?.dueDate;

    // Verificar se já existe Receivable similar (evitar duplicatas)
    const existingReceivable = await this.prisma.receivable.findFirst({
      where: {
        companyId,
        clientId: client.id,
        totalAmount,
        subCategoryId: subCategory?.id || null,
        referenceDate: quotation.createdAt,
        installments: firstDueDate
          ? { some: { dueDate: firstDueDate } }
          : undefined,
      },
    });

    if (existingReceivable) {
      console.log(
        `Receivable já existe para cliente ${client.id} com valor ${totalAmount}, pulando criação duplicada`,
      );
      return existingReceivable;
    }

    const receivable = await this.prisma.receivable.create({
      data: {
        referenceDate: quotation.createdAt,
        description: `Venda ${quotation.quotationNumber}-${series.code}`,
        totalAmount,
        totalValue: totalAmount,
        installmentQty: parcelas.length,
        status: 'PENDING',
        clientId: client.id,
        companyId,
        natureId: nature?.id || null,
        subCategoryId: subCategory?.id || null,
        quotationId: quotation.id,
        financialType: 'MAIN',
        isImported: true,
      },
    });

    // Criar parcelas do Receivable
    const installmentsData = parcelas.map((parcela, index) => ({
      receivableId: receivable.id,
      installmentNumber: index + 1,
      dueDate: parcela.dueDate,
      amount: parcela.value,
      paymentConditionId: paymentCondition?.id || null,
      bankAccountId: defaultBankAccount?.id || null,
      status: 'PENDING' as const,
    }));

    await this.prisma.receivableInstallment.createMany({
      data: installmentsData,
    });

    return receivable;
  }

  /**
   * Criar Payable de frete a partir da ordem importada
   */
  private async createOrderFreightPayable(
    quotation: any,
    firstItem: any,
    companyId: string,
    series: any,
    freteCusto: number,
  ) {
    // Buscar fornecedor (transportador)
    const cleanCpfCnpj = firstItem.FreteFornecedorCpfCnpj.replace(/[^\d]/g, '');
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
      console.warn(
        `Transportador com CPF/CNPJ ${firstItem.FreteFornecedorCpfCnpj} não encontrado`,
      );
      return null;
    }

    // Buscar natureza operacional
    const nature = await this.prisma.nature.findFirst({
      where: {
        companyId,
        isActive: true,
        description: { equals: 'Operacional', mode: 'insensitive' },
      },
    });

    // Buscar subcategoria de frete
    let subCategory = null;
    if (nature) {
      subCategory = await this.prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: { equals: 'Frete', mode: 'insensitive' },
        },
      });
    }

    // Buscar conta bancária padrão
    const defaultBankAccount = await this.prisma.bankAccount.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Criar Payable
    const payable = await this.prisma.payable.create({
      data: {
        referenceDate: quotation.createdAt,
        description: `Frete da venda ${quotation.quotationNumber}-${series.code}`,
        totalAmount: freteCusto,
        totalValue: freteCusto,
        installmentQty: 1,
        status: 'PENDING',
        supplierId: supplier.id,
        companyId,
        natureId: nature?.id || null,
        subCategoryId: subCategory?.id || null,
        quotationId: quotation.id,
        financialType: 'DELIVERY',
      },
    });

    // Criar parcela única
    const vencimento = new Date(quotation.createdAt);
    vencimento.setDate(vencimento.getDate() + 30);

    await this.prisma.payableInstallment.create({
      data: {
        payableId: payable.id,
        installmentNumber: 1,
        dueDate: vencimento,
        amount: freteCusto,
        bankAccountId: defaultBankAccount?.id || null,
        status: 'PENDING',
      },
    });

    return payable;
  }

  /**
   * Criar Payable de comissão a partir da ordem importada
   */
  private async createOrderCommissionPayable(
    quotation: any,
    firstItem: any,
    companyId: string,
    series: any,
    comissaoValor: number,
  ) {
    // Buscar fornecedor (comissionado)
    const cleanCpfCnpj = firstItem.ComissaoFornecedorCpfCnpj.replace(
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
      console.warn(
        `Comissionado com CPF/CNPJ ${firstItem.ComissaoFornecedorCpfCnpj} não encontrado`,
      );
      return null;
    }

    // Buscar natureza operacional
    const nature = await this.prisma.nature.findFirst({
      where: {
        companyId,
        isActive: true,
        description: { equals: 'Operacional', mode: 'insensitive' },
      },
    });

    // Buscar subcategoria de comissão
    let subCategory = null;
    if (nature) {
      subCategory = await this.prisma.subCategory.findFirst({
        where: {
          companyId,
          isActive: true,
          natureId: nature.id,
          description: { equals: 'Comissões', mode: 'insensitive' },
        },
      });
    }

    // Buscar conta bancária padrão
    const defaultBankAccount = await this.prisma.bankAccount.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // Criar Payable
    const payable = await this.prisma.payable.create({
      data: {
        referenceDate: quotation.createdAt,
        description: `Comissão da venda ${quotation.quotationNumber}-${series.code}`,
        totalAmount: comissaoValor,
        totalValue: comissaoValor,
        installmentQty: 1,
        status: 'PENDING',
        supplierId: supplier.id,
        companyId,
        natureId: nature?.id || null,
        subCategoryId: subCategory?.id || null,
        quotationId: quotation.id,
        financialType: 'COMMISSION',
      },
    });

    // Criar parcela única
    const vencimento = new Date(quotation.createdAt);
    vencimento.setDate(vencimento.getDate() + 30);

    await this.prisma.payableInstallment.create({
      data: {
        payableId: payable.id,
        installmentNumber: 1,
        dueDate: vencimento,
        amount: comissaoValor,
        bankAccountId: defaultBankAccount?.id || null,
        status: 'PENDING',
      },
    });

    return payable;
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
          let client = await this.prisma.client.findFirst({
            where: {
              companyId,
              OR: [
                { cpf: { contains: cleanCpfCnpj } },
                { cnpj: { contains: cleanCpfCnpj } },
                { cpf: firstItem.ClienteCpfCnpj },
                { cnpj: firstItem.ClienteCpfCnpj },
              ],
            },
          });

          // Se não encontrou, tentar busca mais flexível
          if (!client) {
            const clients = await this.prisma.client.findMany({
              where: { companyId },
            });
            client =
              clients.find((c: any) => {
                const cleanCpf = (c.cpf || '').replace(/[^\d]/g, '');
                const cleanCnpj = (c.cnpj || '').replace(/[^\d]/g, '');
                return cleanCpf === cleanCpfCnpj || cleanCnpj === cleanCpfCnpj;
              }) || null;
          }

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

        // Buscar funcionário (se for despesa de salário)
        let employeeId: string | null = null;
        if (!isReceivable && firstItem.FuncionarioEmail) {
          const employee = await this.prisma.employee.findFirst({
            where: {
              user: {
                email: firstItem.FuncionarioEmail,
              },
              companyId,
              isActive: true,
            },
          });
          if (!employee) {
            throw new Error(
              `Funcionário com email '${firstItem.FuncionarioEmail}' não encontrado`,
            );
          }
          employeeId = employee.id;
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

        const totalAmount = this.toCents(firstItem.ValorTotal) || 0;
        const referenceDate = firstItem.DataReferencia
          ? new Date(firstItem.DataReferencia)
          : new Date();

        if (isReceivable) {
          // Obter primeiro vencimento para verificação de duplicata
          const firstDueDate = installments[0]?.DataVencimento
            ? new Date(installments[0].DataVencimento)
            : null;

          // Verificar se já existe Receivable similar (evitar duplicatas)
          const existingReceivable = await this.prisma.receivable.findFirst({
            where: {
              companyId,
              clientId: clientId || undefined,
              totalAmount,
              subCategoryId: subCategoryId || undefined,
              referenceDate,
              installments: firstDueDate
                ? { some: { dueDate: firstDueDate } }
                : undefined,
            },
          });

          if (existingReceivable) {
            console.log(
              `Receivable já existe (cliente: ${clientId}, valor: ${totalAmount}), pulando criação duplicada`,
            );
            successCount++;
            continue;
          }

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
              isImported: true,
            },
          });

          // Criar parcelas
          for (const item of installments) {
            const installmentAmount = this.toCents(item.ValorParcela) || 0;
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
                    ? this.toCents(item.ValorPago)
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
          // Obter primeiro vencimento para verificação de duplicata
          const firstDueDate = installments[0]?.DataVencimento
            ? new Date(installments[0].DataVencimento)
            : null;

          // Verificar se já existe Payable similar (evitar duplicatas)
          const existingPayable = await this.prisma.payable.findFirst({
            where: {
              companyId,
              supplierId: supplierId || undefined,
              employeeId: employeeId || undefined,
              totalAmount,
              subCategoryId: subCategoryId || undefined,
              referenceDate,
              installments: firstDueDate
                ? { some: { dueDate: firstDueDate } }
                : undefined,
            },
          });

          if (existingPayable) {
            console.log(
              `Payable já existe (fornecedor: ${supplierId || employeeId}, valor: ${totalAmount}), pulando criação duplicada`,
            );
            successCount++;
            continue;
          }

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
              employeeId,
              natureId,
              subCategoryId,
              notes: firstItem.Observacoes || null,
              status: 'PENDING', // Será atualizado se houver parcelas pagas
              installmentQty: installments.length,
              isImported: true,
            },
          });

          // Criar parcelas
          for (const item of installments) {
            const installmentAmount = this.toCents(item.ValorParcela) || 0;
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
                    ? this.toCents(item.ValorPago)
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

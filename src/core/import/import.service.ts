import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { MinioService } from '../../svc/file-upload/minio.service';
import { ProductFiscalService } from '../fiscal/product-fiscal/product-fiscal.service';
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
  EMPLOYEE_IMPORT_SCHEMA,
  PAYMENT_CONDITION_IMPORT_SCHEMA,
  findCompanyRecordByName,
} from './schemas';
import {
  GENERIC_BANK_CODE,
  FALLBACK_NATURE_DESCRIPTION,
  ImportReference,
  collectBankAccountNames,
  collectNatureNames,
  collectProductCodes,
  collectSectorNames,
  collectSeriesCodes,
  dayDate,
  collectSubCategoryRefs,
  findActiveBankAccountByName,
  findActiveNatureByDescription,
  findActiveSubCategoryByDescription,
  findSectorByName,
} from './import-references';
import {
  resolveOptionalEmail,
  sanitizeOptionalEmail,
} from './optional-value-sanitizers';
import { deleteImportedSales } from './imported-sale-cleanup';

/**
 * Unidades cujo preço total depende de uma medida (área, comprimento, peso…).
 * Para elas o `unitCost` é uma taxa por unidade bruta (R$/mm², R$/segundo…) e
 * só vira total quando multiplicado pela medida.
 */
const DIMENSIONAL_UNIT_KINDS = [
  'AREA',
  'LENGTH',
  'CAPACITY',
  'WEIGHT',
  'DISTANCE',
  'DURATION',
];

/**
 * Índice de clientes montado uma vez por importação, para não varrer a base a
 * cada linha processada.
 */
interface ClientIndex {
  byLegacyId: Map<string, any>;
  byDocument: Map<string, any>;
}

/**
 * Índice de condições de pagamento. `byName` guarda lista, não item único:
 * é justamente o nome repetido que precisa ser detectado.
 */
interface PaymentConditionIndex {
  byLegacyId: Map<string, any>;
  byName: Map<string, any[]>;
  fallback: any | null;
}

@Injectable()
export class ImportService {
  private fileBuffers: Map<string, Buffer> = new Map();

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    private productFiscalService: ProductFiscalService,
  ) {}

  /**
   * Converte valor em reais para centavos (multiplica por 100)
   * Trata valores vazios, nulos e arredonda para evitar erros de ponto flutuante
   */
  private toCents(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    const numValue = this.parseDecimal(value);
    if (isNaN(numValue)) return null;
    return Math.round(numValue * 100);
  }

  private parseDecimal(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return value;

    const normalized = value
      .trim()
      .replace(/\s/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');

    return parseFloat(normalized);
  }

  /**
   * Localiza o vendedor de um orçamento ou ordem importada.
   *
   * Ordem de resolução:
   *
   * 1. `legacyId` — caminho da migração. Casa direto com o colaborador, sem
   *    passar pelo usuário e **sem filtrar por ativo**: parte relevante do
   *    histórico pertence a vendedores já desligados, e descartá-los jogaria
   *    essas vendas para outra pessoa.
   * 2. `email` — caminho de quem importa com o time já cadastrado. Prefere o
   *    colaborador ativo; se não houver, aceita o inativo em vez de falhar.
   * 3. Nenhum identificador — mantém o comportamento antigo de usar o primeiro
   *    vendedor ativo da empresa. Só vale quando o arquivo não informa vendedor.
   *
   * Se um identificador foi informado e não casou, devolve null para o chamador
   * lançar erro: atribuir a venda a outra pessoa é pior do que recusar a linha.
   */
  /**
   * Medida bruta que multiplica o preço unitário da linha.
   *
   * A tela recalcula `unitCost = salePrice / medida` ao abrir o item. Se o
   * `unitCost` gravado não seguir a mesma regra, abrir a linha sobrescreve o
   * valor da venda pelo do catálogo — foi o que aconteceu na primeira carga.
   */
  private rawMeasure(
    unitKind: string | null,
    item: {
      width?: number | null;
      height?: number | null;
      length?: number | null;
      duration?: number | null;
    },
    quantity: number,
  ): number {
    switch (unitKind) {
      case 'AREA':
        return (item.width || 0) * (item.height || 0);
      case 'LENGTH':
        return item.width || item.length || 0;
      case 'DURATION':
        return item.duration || 0;
      default:
        // Unidade avulsa não tem medida própria: a quantidade da linha é
        // aplicada pelo chamador.
        return quantity;
    }
  }

  /**
   * Taxa por unidade bruta coerente com o valor da linha, para a tela não
   * recalcular um valor diferente do que foi vendido.
   */
  private unitCostForLine(
    lineTotalInCents: number | null,
    unitKind: string | null,
    dimensions: {
      width?: number | null;
      height?: number | null;
      length?: number | null;
      duration?: number | null;
    },
    quantity: number,
  ): number | null {
    if (lineTotalInCents === null) return null;

    // A tela obtém a medida total multiplicando a medida unitária pela
    // quantidade da linha; a taxa precisa sair da mesma base.
    const measure = this.rawMeasure(unitKind, dimensions, 1) * (quantity || 1);
    return measure > 0 ? lineTotalInCents / measure : lineTotalInCents;
  }

  /**
   * Converte a medida do documento (metros) para a unidade do banco
   * (milímetros).
   *
   * A coluna do legado está em metros, com três casas decimais. O próprio PDF
   * do sistema antigo comprova: imprime "( 0.100 x 0.100 - 0.01m² )", e só em
   * metros 0,1 × 0,1 resulta em 0,01 m² — em milímetros daria praticamente
   * zero.
   *
   * Devolve nulo quando a linha não informa medida, para o chamador cair na
   * dimensão cadastrada no produto.
   */
  private toMillimeters(value: string | number | null | undefined) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = this.parseDecimal(value);
    if (isNaN(parsed) || parsed <= 0) return null;
    return parsed * 1000;
  }

  private async findSeller(
    companyId: string,
    email?: string | null,
    legacyId?: string | null,
  ) {
    const sellerLegacyId = legacyId?.trim();

    if (sellerLegacyId) {
      return this.prisma.employee.findFirst({
        where: {
          companyId,
          legacyId: sellerLegacyId,
        },
        include: {
          user: true,
        },
      });
    }

    const sellerEmail = email?.trim();

    if (sellerEmail) {
      const active = await this.prisma.employee.findFirst({
        where: {
          user: {
            email: sellerEmail,
          },
          companyId,
          isActive: true,
        },
        include: {
          user: true,
        },
      });

      if (active) return active;

      // Vendedor desligado ainda responde pelo histórico dele.
      return this.prisma.employee.findFirst({
        where: {
          user: {
            email: sellerEmail,
          },
          companyId,
        },
        include: {
          user: true,
        },
      });
    }

    return this.prisma.employee.findFirst({
      where: {
        companyId,
        isActive: true,
        sellerProfileId: { not: null },
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Mensagem de erro que nomeia o identificador realmente usado na linha, para
   * o operador saber onde corrigir: código do legado, e-mail ou nenhum dos dois.
   */
  private sellerNotFoundMessage(row: any): string {
    const legacyId = row.VendedorCodigoLegado?.trim();
    if (legacyId) {
      return `Vendedor com código legado '${legacyId}' não encontrado. Importe os colaboradores antes das vendas.`;
    }

    const email = row.VendedorEmail?.trim();
    if (email) {
      return `Vendedor com email '${email}' não encontrado`;
    }

    return 'Nenhum vendedor ativo encontrado para a empresa';
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
      'employee',
      'paymentCondition',
    ];
    if (!allowedEntities.includes(entity)) {
      throw new BadRequestException('Invalid entity type');
    }

    // Validar formato do arquivo
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
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
  async validateCsv(
    importId: string,
    allowOverride: boolean = false,
  ): Promise<any> {
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
      const rows = (await this.parseCsv(fileBuffer)).map((r) =>
        this.normalizeRow(r),
      );

      // Validar schema
      const schema = this.getSchema(importLog.entity);
      const validationResult = await this.validateRows(
        rows,
        schema,
        importLog.companyId,
        allowOverride,
      );

      // Cadastros citados no arquivo que a empresa ainda não tem. Criar conta
      // bancária é feature de plano (em Trial o cliente nem enxerga a tela), e
      // natureza/subcategoria vêm às centenas no extrato de outro sistema —
      // devolvemos a lista para a tela oferecer o cadastro em vez de só barrar.
      const missingRecords =
        importLog.entity === 'financial'
          ? await this.findMissingReferences(rows, importLog.companyId)
          : [];

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
        warnings: validationResult.warnings,
        missingRecords,
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
   * Cadastros citados no CSV que a empresa não tem ativos: natureza,
   * subcategoria e conta bancária.
   */
  private async findMissingReferences(
    rows: any[],
    companyId: string,
  ): Promise<ImportReference[]> {
    const missing: ImportReference[] = [];

    for (const name of collectNatureNames(rows)) {
      const nature = await findActiveNatureByDescription(
        this.prisma,
        companyId,
        name,
      );
      if (!nature) missing.push({ type: 'nature', name });
    }

    for (const ref of collectSubCategoryRefs(rows)) {
      // Mesma regra do validador: com natureza declarada, a subcategoria precisa
      // estar pendurada nela para contar como existente.
      const nature = ref.parent
        ? await findActiveNatureByDescription(
            this.prisma,
            companyId,
            ref.parent,
          )
        : null;

      const subCategory = await findActiveSubCategoryByDescription(
        this.prisma,
        companyId,
        ref.name,
        nature?.id,
      );

      if (!subCategory) {
        missing.push({
          type: 'subCategory',
          name: ref.name,
          ...(ref.parent ? { parent: ref.parent } : {}),
        });
      }
    }

    for (const name of collectBankAccountNames(rows)) {
      const account = await findActiveBankAccountByName(
        this.prisma,
        companyId,
        name,
      );
      if (!account) missing.push({ type: 'bankAccount', name });
    }

    return missing;
  }

  /**
   * Cria os cadastros citados no CSV que ainda não existem, após a confirmação
   * do usuário na tela de importação.
   *
   * Os nomes saem do próprio arquivo já enviado — não de um payload arbitrário —
   * então a criação fica limitada ao que a importação realmente precisa.
   *
   * A ordem importa: subcategoria depende de uma natureza-pai, que pode ter sido
   * criada agora mesmo. Registro inativo de mesmo nome é reativado em vez de
   * duplicado, porque o validador filtra por `isActive`.
   */
  async createMissingReferences(importId: string) {
    const importLog = await this.prisma.importLog.findUnique({
      where: { id: importId },
    });

    if (!importLog) {
      throw new BadRequestException('Import not found');
    }

    if (importLog.entity !== 'financial') {
      throw new BadRequestException(
        'Only financial imports reference these records',
      );
    }

    const fileBuffer = this.fileBuffers.get(importId);

    if (!fileBuffer) {
      throw new BadRequestException(
        'File not found. Please upload the file again.',
      );
    }

    const rows = (await this.parseCsv(fileBuffer)).map((r) =>
      this.normalizeRow(r),
    );

    return this.ensureFinancialReferences(rows, importLog.companyId);
  }

  /**
   * Cria natureza, subcategoria e conta bancária citadas nas linhas.
   *
   * Serve às duas origens: o CSV da tela e a migração do legado, que chega com
   * as linhas em memória em vez de um arquivo enviado.
   *
   * A ordem importa: subcategoria depende de uma natureza-pai, que pode ter
   * sido criada agora mesmo. Registro inativo de mesmo nome é reativado em vez
   * de duplicado, porque o validador filtra por `isActive`.
   */
  async ensureFinancialReferences(rows: any[], companyId: string) {
    const created: ImportReference[] = [];
    const reactivated: ImportReference[] = [];
    const skipped: ImportReference[] = [];

    // Id de cada natureza resolvida no passo 1, para o passo 2 pendurar a
    // subcategoria sem reconsultar o que acabou de ser gravado.
    const natureIdByName = new Map<string, string>();
    const rememberNature = (name: string, id: string) =>
      natureIdByName.set(name.trim().toLowerCase(), id);

    // 1. Naturezas — precisam existir antes das subcategorias.
    for (const name of collectNatureNames(rows)) {
      const active = await findActiveNatureByDescription(
        this.prisma,
        companyId,
        name,
      );

      if (active) {
        rememberNature(name, active.id);
        skipped.push({ type: 'nature', name });
        continue;
      }

      const inactive = await this.prisma.nature.findFirst({
        where: {
          description: { equals: name, mode: 'insensitive' },
          companyId,
        },
      });

      if (inactive) {
        await this.prisma.nature.update({
          where: { id: inactive.id },
          data: { isActive: true },
        });
        rememberNature(name, inactive.id);
        reactivated.push({ type: 'nature', name });
        continue;
      }

      const createdNature = await this.prisma.nature.create({
        data: { description: name, companyId },
      });
      rememberNature(name, createdNature.id);
      created.push({ type: 'nature', name });
    }

    // 2. Subcategorias.
    for (const ref of collectSubCategoryRefs(rows)) {
      const parentNatureId = ref.parent
        ? natureIdByName.get(ref.parent.trim().toLowerCase())
        : undefined;

      const active = await findActiveSubCategoryByDescription(
        this.prisma,
        companyId,
        ref.name,
        parentNatureId,
      );

      if (active) {
        skipped.push({ type: 'subCategory', name: ref.name });
        continue;
      }

      const natureId =
        parentNatureId ?? (await this.resolveFallbackNatureId(companyId));

      const inactive = await this.prisma.subCategory.findFirst({
        where: {
          description: { equals: ref.name, mode: 'insensitive' },
          companyId,
          natureId,
        },
      });

      if (inactive) {
        await this.prisma.subCategory.update({
          where: { id: inactive.id },
          data: { isActive: true },
        });
        reactivated.push({ type: 'subCategory', name: ref.name });
        continue;
      }

      await this.prisma.subCategory.create({
        data: { description: ref.name, natureId, companyId },
      });
      created.push({ type: 'subCategory', name: ref.name });
    }

    // 3. Contas bancárias.
    const bankAccountNames = collectBankAccountNames(rows);

    if (bankAccountNames.length > 0) {
      const bank = await this.prisma.bank.findFirst({
        where: { code: GENERIC_BANK_CODE },
      });

      if (!bank) {
        throw new BadRequestException(
          `Banco de código ${GENERIC_BANK_CODE} não encontrado`,
        );
      }

      // O cadastro pela tela cria uma linha de controle de caixa por condição de
      // pagamento, todas desligadas por padrão. Replicado aqui para a conta criada
      // pela importação ficar igual a uma criada pela interface.
      const paymentConditions = await this.prisma.paymentCondition.findMany({
        where: { companyId, isActive: true },
        select: { id: true },
      });

      for (const name of bankAccountNames) {
        const active = await findActiveBankAccountByName(
          this.prisma,
          companyId,
          name,
        );

        if (active) {
          skipped.push({ type: 'bankAccount', name: active.name });
          continue;
        }

        const inactive = await this.prisma.bankAccount.findFirst({
          where: {
            name: { equals: name, mode: 'insensitive' },
            companyId,
          },
        });

        if (inactive) {
          await this.prisma.bankAccount.update({
            where: { id: inactive.id },
            data: { isActive: true },
          });
          reactivated.push({ type: 'bankAccount', name: inactive.name });
          continue;
        }

        await this.prisma.bankAccount.create({
          data: {
            name,
            description: 'Criada pela importação financeira',
            companyId,
            bankId: bank.id,
            cashControl: true,
            bankAccountCashControl: {
              createMany: {
                data: paymentConditions.map((condition) => ({
                  paymentConditionId: condition.id,
                  acceptIncomes: false,
                  incomeType: 'PAYSOFF' as const,
                  acceptPayments: false,
                  paymentType: 'PAYSOFF' as const,
                })),
              },
            },
          },
        });

        created.push({ type: 'bankAccount', name });
      }
    }

    return { created, reactivated, skipped };
  }

  /** Setores citados nas linhas de produto que a empresa ainda não tem. */
  async findMissingSectors(rows: any[], companyId: string): Promise<string[]> {
    const missing: string[] = [];

    for (const name of collectSectorNames(rows)) {
      const sector = await findSectorByName(this.prisma, companyId, name);
      if (!sector) missing.push(name);
    }

    return missing;
  }

  /**
   * Cria os setores que os produtos citam e a empresa não tem.
   *
   * O produto guarda o setor, e a carga não recusa a linha por causa dele: sem
   * o cadastro, o produto entraria com setor vazio e sumiria dos filtros da
   * produção. Os nomes saem da própria carga, não de um payload arbitrário.
   *
   * Nasce como etapa de produção porque é assim que o setor de um produto é
   * usado; setor de outra natureza o cliente ajusta depois no cadastro.
   */
  async ensureProductSectors(
    rows: any[],
    companyId: string,
  ): Promise<string[]> {
    const missing = await this.findMissingSectors(rows, companyId);

    for (const name of missing) {
      await this.prisma.companySector.create({
        data: {
          name,
          companyId,
          kind: 'PRODUCTION',
          isProductionStage: true,
        },
      });
    }

    return missing;
  }

  /**
   * Data de um dia só (planilha ou legado), gravada ao meio-dia UTC.
   *
   * O valor chega como 'AAAA-MM-DD' e `new Date` o lê como meia-noite UTC —
   * que no fuso do Brasil é o dia anterior às 21h. As listas leem a data em
   * UTC e mostram o dia certo, mas a tela do documento e o PDF convertem para
   * São Paulo e mostravam um dia a menos. Meio-dia cai no mesmo dia nos dois.
   */
  /**
   * O documento já migrado ainda corresponde ao que o legado mostra hoje?
   *
   * Entre a primeira carga e a virada o cliente continua trabalhando no
   * legado: o orçamento vira ordem de serviço, o valor muda. Pular o documento
   * por já existir congelava a conta nova no estado da primeira carga.
   *
   * Atualizar exige apagar e reimportar, porque as relações filhas não têm
   * exclusão em cascata. Daí a recusa quando já há nota fiscal no documento:
   * apagar levaria a nota junto.
   */
  private async refreshImportedSale(
    quotationId: string,
    expected: { hasOrder: boolean; totalValue: number; status?: string },
  ): Promise<'unchanged' | 'refreshed' | 'blocked'> {
    const atual = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: {
        status: true,
        totalValue: true,
        order: {
          select: {
            id: true,
            _count: { select: { nfes: true, nfces: true, nfses: true } },
          },
        },
        _count: { select: { nfes: true, nfces: true, nfses: true } },
      },
    });

    if (!atual) return 'unchanged';

    const mudou =
      !!atual.order !== expected.hasOrder ||
      Math.round(atual.totalValue) !== Math.round(expected.totalValue) ||
      (!!expected.status && atual.status !== expected.status);

    if (!mudou) return 'unchanged';

    const notas =
      atual._count.nfes +
      atual._count.nfces +
      atual._count.nfses +
      (atual.order?._count.nfes ?? 0) +
      (atual.order?._count.nfces ?? 0) +
      (atual.order?._count.nfses ?? 0);

    if (notas > 0) return 'blocked';

    await deleteImportedSales(this.prisma, [quotationId]);
    return 'refreshed';
  }

  /** Valor do documento no legado, já com o desconto das linhas. */
  private expectedSaleTotal(items: any[]): number {
    return items.reduce(
      (sum, item) => sum + this.lineValues(item).finalValue,
      0,
    );
  }

  /**
   * Valores da linha do documento, em centavos.
   *
   * O legado guarda o desconto por item, separado do valor total: sem ele o
   * documento migrado fecha pelo valor cheio. E o desconto tem que vir na
   * mesma unidade do valor — lido em reais, um desconto de R$ 100,00 tirava
   * R$ 1,00 do total.
   */
  private lineValues(item: any): {
    totalValue: number;
    discount: number;
    finalValue: number;
  } {
    const totalValue = this.toCents(item.ValorTotal) || 0;
    const discount = this.toCents(item.Desconto) || 0;

    return { totalValue, discount, finalValue: totalValue - discount };
  }

  private toDayDate(value: string): Date {
    return dayDate(value);
  }

  private documentDigits(value: string | null | undefined): string {
    return String(value ?? '').replace(/[^\d]/g, '');
  }

  /**
   * Cadastros que a conta já tem sem vínculo com o legado, por documento.
   *
   * Serve à migração numa conta que já estava em uso: sem isso, quem o cliente
   * cadastrou à mão entra de novo pelo legado e a base fica com dois registros
   * da mesma pessoa. O índice é montado uma vez por etapa — procurar por linha
   * custaria uma varredura da base a cada registro.
   */
  async buildAdoptionIndex(
    entity: 'client' | 'employee' | 'supplier',
    companyId: string,
  ): Promise<Map<string, string>> {
    const where = { companyId, legacyId: null };

    const records: any[] =
      entity === 'client'
        ? await this.prisma.client.findMany({
            where,
            select: { id: true, cpf: true, cnpj: true },
          })
        : entity === 'supplier'
          ? await this.prisma.supplier.findMany({
              where,
              select: { id: true, cpf: true, cnpj: true },
            })
          : await this.prisma.employee.findMany({
              where,
              select: { id: true, cpf: true },
            });

    const index = new Map<string, string>();

    for (const record of records) {
      for (const value of [record.cnpj, record.cpf]) {
        const document = this.documentDigits(value);
        if (document && !index.has(document)) index.set(document, record.id);
      }
    }

    return index;
  }

  /**
   * Produtos que a conta já tem com o mesmo código e não vieram da migração.
   *
   * A carga usa esses cadastros como estão, então a venda migrada herda a
   * unidade e as medidas que o cliente cadastrou. Produto sem item é relatado à
   * parte: a venda que o usa não tem de onde tirar a unidade e falha.
   */
  async findProductAdoptions(
    rows: any[],
    companyId: string,
  ): Promise<{ adopted: string[]; withoutItem: string[] }> {
    const products = await this.prisma.product.findMany({
      where: { companyId },
      select: {
        code: true,
        legacyId: true,
        items: { select: { id: true }, take: 1 },
      },
    });

    const byCode = new Map(
      products.map((product) => [product.code.trim().toLowerCase(), product]),
    );

    const adopted: string[] = [];
    const withoutItem: string[] = [];

    for (const code of collectProductCodes(rows)) {
      const existing = byCode.get(code.trim().toLowerCase());
      if (!existing || existing.legacyId === code.trim()) continue;

      adopted.push(code);
      if (existing.items.length === 0) withoutItem.push(code);
    }

    return { adopted, withoutItem };
  }

  /**
   * Quando a conta passou a ser usada fora da migração.
   *
   * É a data de corte do financeiro: o histórico do legado a partir dela
   * duplicaria o que o cliente já lançou no sistema novo.
   *
   * Uma carga anterior não pode contar como uso: até esta versão, a entrada da
   * venda, o frete e a comissão nasciam sem a marca de importado, e a data da
   * migração anterior virava a data de corte — justamente o período que a nova
   * carga precisa trazer. Por isso o vínculo com o documento também é
   * conferido, e não só a marca.
   */
  async firstNonImportedActivity(companyId: string): Promise<Date | null> {
    const [quotation, receivable] = await Promise.all([
      this.prisma.quotation.findFirst({
        where: { companyId, isImported: false },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.receivable.findFirst({
        where: {
          companyId,
          isImported: false,
          OR: [{ quotationId: null }, { quotation: { isImported: false } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const dates = [quotation?.createdAt, receivable?.createdAt].filter(
      Boolean,
    ) as Date[];

    if (dates.length === 0) return null;
    return new Date(Math.min(...dates.map((date) => date.getTime())));
  }

  /**
   * Série em que o documento migrado é gravado.
   *
   * Numa conta que já tem documentos, o número que vem do legado colide com os
   * que o cliente já emitiu: dois documentos com o mesmo número na mesma série,
   * sem nada no banco que impeça. O histórico vai então para uma série própria,
   * que preserva o número original e separa o que é do sistema antigo.
   */
  private async resolveImportSeries(
    companyId: string,
    code: string,
    historySeries?: boolean,
  ) {
    const original = await this.prisma.saleSeries.findFirst({
      where: { code, companyId, isActive: true },
    });

    if (original && !historySeries) return original;

    const targetCode = this.importSeriesCode(code, historySeries);

    const existing = await this.prisma.saleSeries.findFirst({
      where: { code: targetCode, companyId },
    });
    if (existing) return existing;

    // Herda a apresentação da série que o cliente usa, para o documento
    // migrado sair com a mesma cara dos demais.
    const base =
      original ??
      (await this.prisma.saleSeries.findFirst({
        where: { companyId, isDefault: true },
      })) ??
      (await this.prisma.saleSeries.findFirst({ where: { companyId } }));

    return this.prisma.saleSeries.create({
      data: {
        companyId,
        code: targetCode,
        title: historySeries
          ? `Histórico do legado ${code}`.trim()
          : `Série ${code}`.trim(),
        description: 'Criada pela migração do sistema legado',
        deliveryDeadline: base?.deliveryDeadline ?? null,
        proposalValidity: base?.proposalValidity ?? null,
        textBeforeItems: base?.textBeforeItems ?? null,
        textAfterItems: base?.textAfterItems ?? null,
        billing: base?.billing,
        productionStatus: base?.productionStatus,
        sendToProduction: base?.sendToProduction,
      },
    });
  }

  /**
   * Código da série que recebe o documento migrado.
   *
   * Numa conta em uso o histórico vai para série própria; numa conta vazia, o
   * documento fica na série que o legado indica, criada se não existir — o
   * número precisa ser o mesmo que o cliente tem nos papéis antigos.
   */
  private importSeriesCode(code: string, historySeries?: boolean): string {
    if (!historySeries) return code || 'LEG';
    return code ? `LEG-${code}` : 'LEG';
  }

  /** Séries que a carga vai criar para os documentos migrados. */
  async findMissingImportSeries(
    rows: any[],
    companyId: string,
    historySeries?: boolean,
  ): Promise<string[]> {
    const missing: string[] = [];

    for (const code of collectSeriesCodes(rows)) {
      const target = this.importSeriesCode(code, historySeries);
      const existing = await this.prisma.saleSeries.findFirst({
        where: { code: target, companyId },
      });
      if (!existing) missing.push(target);
    }

    return missing;
  }

  /** A conta já tem documento criado fora da migração. */
  async hasOwnDocuments(companyId: string): Promise<boolean> {
    const count = await this.prisma.quotation.count({
      where: { companyId, isImported: false },
    });
    return count > 0;
  }

  /** Banco genérico de que a criação de conta bancária depende. */
  async findGenericBank() {
    return this.prisma.bank.findFirst({ where: { code: GENERIC_BANK_CODE } });
  }

  /**
   * Natureza-pai para subcategoria que veio sem natureza na planilha. Reaproveita
   * a primeira ativa da empresa e só cria a padrão quando não existe nenhuma —
   * mesma receita que o import de produtos usa para o grupo.
   */
  private async resolveFallbackNatureId(companyId: string): Promise<string> {
    const existing = await this.prisma.nature.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) return existing.id;

    const created = await this.prisma.nature.create({
      data: { description: FALLBACK_NATURE_DESCRIPTION, companyId },
    });

    return created.id;
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

      const lines = content.split(/\r?\n/);
      const separatorDirective = lines[0]?.trim().match(/^sep=(.)$/i);
      if (separatorDirective) {
        lines.shift();
        content = lines.join('\n');
      }

      // Auto detect delimiter based on the first real header line
      const headLine = lines.find((line) => line.trim() !== '') || '';
      const commaCount = (headLine.match(/,/g) || []).length;
      const semicolonCount = (headLine.match(/;/g) || []).length;
      const delimiter =
        separatorDirective?.[1] || (semicolonCount > commaCount ? ';' : ',');

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
      employee: EMPLOYEE_IMPORT_SCHEMA,
      paymentCondition: PAYMENT_CONDITION_IMPORT_SCHEMA,
    };

    return schemas[entity];
  }

  /**
   * Validar linhas do CSV
   */
  private async validateRows(
    rows: any[],
    schema: Record<string, any>,
    companyId: string,
    allowOverride: boolean = false,
  ): Promise<any> {
    const errors: any[] = [];
    const warnings: any[] = [];
    let validRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 porque linha 1 é header e array começa em 0

      const rowIssues = await this.validateRow(
        row,
        schema,
        companyId,
        rowNumber,
        allowOverride,
      );

      // Aviso não reprova a linha: é campo opcional que será normalizado.
      const rowErrors = rowIssues.filter(
        (issue) => issue.severity !== 'warning',
      );
      warnings.push(
        ...rowIssues.filter((issue) => issue.severity === 'warning'),
      );

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
      } else {
        validRows++;
      }
    }

    return { validRows, errors, warnings };
  }

  /**
   * Validar uma linha específica
   */
  private async validateRow(
    row: any,
    schema: any,
    companyId: string,
    rowNumber: number,
    allowOverride: boolean = false,
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
        // E-mail é campo opcional em todos os schemas: barrar o arquivo inteiro
        // por causa dele é desproporcional. Normalizamos o que der (planilha
        // costuma trazer dois e-mails no mesmo campo) e o usuário confirma a
        // perda na revisão, em vez de ter que editar o CSV.
        const sanitized = field.required ? null : sanitizeOptionalEmail(value);

        errors.push({
          row: rowNumber,
          field: field.name,
          value,
          error: sanitized ? sanitized.message : `Formato de email inválido`,
          ...(sanitized
            ? { severity: 'warning', newValue: sanitized.value }
            : {}),
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
          allowOverride,
        );
        if (customError) {
          // Validador pode devolver texto (reprova a linha) ou objeto com
          // severidade, para o caso em que a divergência merece ser relatada
          // sem impedir a importação.
          const issue =
            typeof customError === 'string'
              ? { error: customError }
              : customError;

          errors.push({
            row: rowNumber,
            field: field.name,
            value,
            ...issue,
          });
        }
      }
    }

    // Regras que dependem de mais de uma coluna. O laço acima pula campo
    // opcional vazio, então uma regra do tipo "informe A ou B" não tem como
    // morar em nenhum dos dois campos.
    if (schema.validateRow) {
      const rowError = await schema.validateRow(row, companyId, this.prisma);
      if (rowError) {
        errors.push({
          row: rowNumber,
          field: '',
          value: '',
          error: rowError,
        });
      }
    }

    return errors;
  }

  /**
   * Normalizar linha do CSV: converte valores nulos exportados por sistemas externos
   * ("NULL", "N/A", "NA", "None", "-") para string vazia
   */
  private normalizeRow(row: any): any {
    const nullPattern = /^(null|n\/a|na|none|-)$/i;
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === 'string' && nullPattern.test(v.trim()) ? '' : v,
      ]),
    );
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
      const rows = (await this.parseCsv(fileBuffer)).map((r) =>
        this.normalizeRow(r),
      );

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
            let shouldCount = true;
            if (importLog.entity === 'client') {
              await this.importClient(row, importLog.companyId);
            } else if (importLog.entity === 'product') {
              await this.importProduct(row, importLog.companyId);
            } else if (importLog.entity === 'supplier') {
              shouldCount = await this.importSupplier(row, importLog.companyId);
            } else if (importLog.entity === 'paymentCondition') {
              await this.importPaymentCondition(row, importLog.companyId);
            } else if (importLog.entity === 'employee') {
              await this.importEmployee(
                row,
                importLog.companyId,
                importLog.userId,
              );
            }

            if (shouldCount) successCount++;
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
  private async importClient(
    row: any,
    companyId: string,
    /** Cadastros sem vínculo com o legado, por documento. Só a migração passa. */
    adoption?: Map<string, string>,
  ): Promise<void> {
    // Normalizar tipo
    let type = row.tipo?.toUpperCase();
    if (type === 'F' || type === 'PESSOA' || type === 'CPF') type = 'PERSON';
    if (type === 'J' || type === 'EMPRESA' || type === 'CNPJ') type = 'COMPANY';

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

    const legacyId = row.codigoLegado?.trim() || null;

    // Reimportar o mesmo arquivo não pode duplicar a base de clientes. Quando a
    // linha traz o código do legado, ele é a identidade do registro.
    if (legacyId) {
      const existing = await this.prisma.client.findFirst({
        where: { companyId, legacyId },
        select: { id: true, isImported: true },
      });

      // Cadastro adotado numa carga anterior é do cliente, não da migração:
      // atualizar sobrescreveria o que ele mantém desde que entrou no sistema.
      if (existing && !existing.isImported) return;

      if (existing) {
        // Só os campos escalares: recriar endereço e contato duplicaria os
        // vínculos a cada reprocessamento.
        await this.prisma.client.update({
          where: { id: existing.id },
          data: {
            type: type || 'PERSON',
            name: row.nome,
            email: resolveOptionalEmail(row.email),
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
          },
        });
        return;
      }
    }

    // Conta que já estava em uso: a pessoa pode já estar cadastrada. Adotar a
    // ficha existente evita duas do mesmo cliente — e é ela que fica, porque o
    // cadastro do cliente é mais recente que o do legado.
    const document = cnpjNormalized || cpfNormalized;
    if (legacyId && document && adoption?.has(document)) {
      const adoptedId = adoption.get(document) as string;
      adoption.delete(document);

      await this.prisma.client.update({
        where: { id: adoptedId },
        data: { legacyId },
      });
      return;
    }

    // Criar cliente
    await this.prisma.client.create({
      data: {
        companyId,
        legacyId,
        type: type || 'PERSON',
        name: row.nome,
        email: resolveOptionalEmail(row.email),
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
                    email: resolveOptionalEmail(row.responsavelEmail),
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
  private async importSupplier(
    row: any,
    companyId: string,
    adoption?: Map<string, string>,
  ): Promise<boolean> {
    // Normalizar tipo
    let type = row.tipo?.toUpperCase();
    if (type === 'F' || type === 'PESSOA' || type === 'CPF') type = 'PERSON';
    if (type === 'J' || type === 'EMPRESA' || type === 'CNPJ') type = 'COMPANY';

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

    const legacyId = row.codigoLegado?.trim() || null;

    // Com código do legado, ele é a identidade: reprocessar atualiza em vez de
    // duplicar. A deduplicação por documento não cobre isso — na base piloto,
    // 22 dos 25 fornecedores não têm CPF nem CNPJ.
    if (legacyId) {
      const existing = await this.prisma.supplier.findFirst({
        where: { companyId, legacyId },
        select: { id: true, isImported: true },
      });

      if (existing) {
        // Cadastro adotado numa carga anterior é do cliente, não da migração.
        if (!existing.isImported) return false;

        await this.prisma.supplier.update({
          where: { id: existing.id },
          data: {
            type: type || 'COMPANY',
            name: row.nome,
            email: resolveOptionalEmail(row.email),
            cpf: cpfNormalized,
            cnpj: cnpjNormalized,
            rg: row.rg || null,
            phone: row.telefone || null,
            mobile: row.celular || null,
            corporateName: row.razaoSocial || null,
            notes: row.observacoes || null,
            categoryId,
            isBranch,
          },
        });
        return true;
      }
    }

    // Conta que já estava em uso: adotar o fornecedor existente dá ao cadastro
    // dele o vínculo com o legado, que o "ignorar" abaixo deixava de fora.
    const document = cnpjNormalized || cpfNormalized;
    if (legacyId && document && adoption?.has(document)) {
      const adoptedId = adoption.get(document) as string;
      adoption.delete(document);

      await this.prisma.supplier.update({
        where: { id: adoptedId },
        data: { legacyId },
      });
      return false;
    }

    // Ignorar se CNPJ ou CPF já está cadastrado
    if (cnpjNormalized) {
      const dup = await this.prisma.supplier.findFirst({
        where: { cnpj: cnpjNormalized, companyId },
      });
      if (dup) return false;
    }
    if (cpfNormalized) {
      const dup = await this.prisma.supplier.findFirst({
        where: { cpf: cpfNormalized, companyId },
      });
      if (dup) return false;
    }

    // Criar fornecedor
    await this.prisma.supplier.create({
      data: {
        companyId,
        legacyId,
        type: type || 'COMPANY',
        name: row.nome,
        email: resolveOptionalEmail(row.email),
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
                    email: resolveOptionalEmail(row.responsavelEmail),
                    phone: row.responsavelTelefone || null,
                    mobile: row.responsavelCelular || null,
                  },
                ],
              }
            : undefined,
      },
    });
    return true;
  }

  /**
   * Importar uma condição de pagamento do legado.
   *
   * A empresa já nasce com condições próprias no cadastro inicial, mas elas não
   * têm vínculo com o legado. Como as vendas referenciam a condição pelo código
   * do sistema antigo, sem esta etapa toda venda importada falha ao procurá-la.
   *
   * Idempotente por (companyId, legacyId).
   */
  private async importPaymentCondition(
    row: any,
    companyId: string,
  ): Promise<void> {
    const legacyId = row.codigoLegado?.trim();
    if (!legacyId) {
      throw new Error("Campo 'codigoLegado' é obrigatório");
    }

    // Forma de pagamento é obrigatória no modelo e o cadastro é global, não por
    // empresa. Quando o nome do legado não casa com nenhuma, usamos a primeira
    // ativa: para histórico o que importa é a condição, não o meio.
    const methodName = row.formaPagamento?.trim();

    const method =
      (methodName
        ? await this.prisma.paymentMethod.findFirst({
            where: { name: { equals: methodName, mode: 'insensitive' } },
          })
        : null) ||
      (await this.prisma.paymentMethod.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      }));

    if (!method) {
      throw new Error(
        'A empresa não tem forma de pagamento cadastrada; rode os cadastros base antes de importar',
      );
    }

    const maxInstallments = parseInt(row.maxParcelas, 10);
    const minInstallments = parseInt(row.minParcelas, 10);
    const dayInterval = parseInt(row.intervaloDias, 10);

    const data = {
      name: row.nome?.trim(),
      costType:
        row.custoTipo?.trim().toUpperCase() === 'VALUE'
          ? ('VALUE' as const)
          : ('PERCENT' as const),
      paymentMethodId: method.id,
      minInstallments: isNaN(minInstallments) ? null : minInstallments,
      maxInstallments: isNaN(maxInstallments) ? null : maxInstallments,
      dayInterval: isNaN(dayInterval) ? null : dayInterval,
      acceptInstallments: !isNaN(maxInstallments) && maxInstallments > 1,
      isActive: row.ativo
        ? ['SIM', 'S', 'TRUE', '1', 'YES'].includes(
            row.ativo.trim().toUpperCase(),
          )
        : true,
    };

    const existing = await this.prisma.paymentCondition.findFirst({
      where: { companyId, legacyId },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.paymentCondition.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    await this.prisma.paymentCondition.create({
      data: { ...data, companyId, legacyId },
    });
  }

  /**
   * Importar um colaborador do CSV.
   *
   * Não cria conta de usuário: a decisão da migração é trazer a pessoa como
   * colaborador e deixar o admin da empresa criar o acesso depois, só para quem
   * precisar. Por isso o vínculo com o histórico de vendas é feito por
   * `legacyId`, e não pelo e-mail do usuário como no restante do importador.
   *
   * Idempotente por (companyId, legacyId): reprocessar o mesmo arquivo atualiza
   * o colaborador em vez de duplicá-lo.
   */
  private async importEmployee(
    row: any,
    companyId: string,
    userId?: string,
    adoption?: Map<string, string>,
  ): Promise<void> {
    const legacyId = row.codigoLegado?.trim();
    if (!legacyId) {
      throw new Error("Campo 'codigoLegado' é obrigatório");
    }

    const [sector, role, sellerProfile] = await Promise.all([
      findCompanyRecordByName(
        this.prisma,
        'companySector',
        companyId,
        row.setor,
      ),
      findCompanyRecordByName(this.prisma, 'role', companyId, row.cargo),
      findCompanyRecordByName(
        this.prisma,
        'sellerProfile',
        companyId,
        row.perfilVendedor,
      ),
    ]);

    // Colaborador desligado também entra: parte relevante do histórico de vendas
    // pertence a quem já saiu, e o orçamento exige vendedor obrigatoriamente.
    const isActive = row.ativo
      ? ['SIM', 'S', 'TRUE', '1', 'YES'].includes(
          row.ativo.trim().toUpperCase(),
        )
      : true;

    let cpf: string | null = null;
    if (row.cpf) {
      let cpfClean = row.cpf.replace(/\D/g, '');
      // Excel remove zeros à esquerda ao abrir o CSV
      if (cpfClean.length < 11 && cpfClean.length >= 9) {
        cpfClean = cpfClean.padStart(11, '0');
      }
      cpf = cpfClean;
    }

    const data = {
      name: row.nome?.trim() || null,
      cpf,
      rg: row.rg || null,
      phone: row.telefone || null,
      mobile: row.celular || null,
      // sallary é gravado em centavos, como todo valor monetário do sistema
      sallary: this.toCents(row.salario),
      isActive,
      sectorId: sector?.id ?? null,
      roleId: role?.id ?? null,
      sellerProfileId: sellerProfile?.id ?? null,
    };

    const existing = await this.prisma.employee.findFirst({
      where: { companyId, legacyId },
    });

    if (existing) {
      // Cadastro adotado numa carga anterior é do cliente, não da migração:
      // sobrescrever apagaria o que ele mantém desde que entrou no sistema.
      if (!existing.isImported) return;

      await this.prisma.employee.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    // Conta que já estava em uso: a pessoa pode já ter cadastro, e até acesso
    // ao sistema. Adotar evita dois colaboradores para o mesmo CPF.
    if (cpf && adoption?.has(cpf)) {
      const adoptedId = adoption.get(cpf) as string;
      adoption.delete(cpf);

      await this.prisma.employee.update({
        where: { id: adoptedId },
        data: { legacyId },
      });
      return;
    }

    const employee = await this.prisma.employee.create({
      data: { ...data, companyId, legacyId, isImported: true },
    });

    // Mesmos efeitos colaterais do cadastro manual: sem os setups de folha, o
    // colaborador importado fica invisível para a folha de pagamento.
    const templates = await this.prisma.payrollTemplate.findMany({
      where: { companyId },
    });
    if (templates.length > 0) {
      await this.prisma.payrollSetup.createMany({
        data: templates.map((template: any) => ({
          name: template.name,
          type: template.type,
          amount: template.defaultAmount || 0,
          isSet: true,
          companyId,
          employeeId: employee.id,
          templateId: template.id,
        })),
      });
    }

    if (userId) {
      await this.prisma.employeeHistory.create({
        data: {
          employeeId: employee.id,
          action: 'CREATE',
          description: `Colaborador importado do sistema legado (código ${legacyId})`,
          createdBy: userId,
        },
      });
    }
  }

  /**
   * Importar um produto do CSV
   */
  private async importProduct(
    row: any,
    companyId: string,
    options: { legacy?: boolean } = {},
  ): Promise<void> {
    // O código do produto no legado é o próprio código do produto. Guardá-lo
    // é o que distingue, numa recarga, o produto que esta migração criou do
    // que o cliente já tinha com o mesmo código.
    const legacyCode = options.legacy ? row.codigo?.trim() || null : null;

    // Produto que esta migração criou. O vínculo vale mais que o código: se o
    // cliente mudou o código depois, procurar só por código não acha o
    // registro e a criação esbarra na chave do legado.
    let mine: any = null;

    if (legacyCode) {
      mine = await this.prisma.product.findFirst({
        where: { companyId, legacyId: legacyCode },
      });

      if (!mine) {
        const sameCode = await this.prisma.product.findFirst({
          where: {
            code: { equals: legacyCode, mode: 'insensitive' },
            companyId,
          },
          select: { id: true },
        });

        // Conta que já estava em uso: o código pertence a um produto que o
        // cliente cadastrou. O histórico se pendura nele e nada é sobrescrito
        // — o mesmo código pode descrever outro produto, e o cadastro do
        // cliente é mais recente que o do legado.
        if (sameCode) return;
      }
    }

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

    // Converter campos booleanos / flags
    const allowEditValues = row.permitirEdicao
      ? ['SIM', 'S', 'TRUE', '1', 'YES'].includes(
          row.permitirEdicao.toUpperCase(),
        )
      : true;
    const allowEditDescription = allowEditValues;

    const isService = false;

    // Verificar se produto já existe (case-insensitive)
    const existingProduct =
      mine ??
      (await this.prisma.product.findFirst({
        where: {
          code: { equals: row.codigo, mode: 'insensitive' },
          companyId,
        },
      }));

    let product = existingProduct;
    if (!product) {
      // Criar produto se não existir
      product = await this.prisma.product.create({
        data: {
          companyId,
          legacyId: legacyCode,
          // O espaço nas pontas do código do legado faria a busca por código
          // falhar na recarga, e a criação repetida bateria na chave.
          code: legacyCode ?? row.codigo,
          name: row.nome,
          technicalDescription: row.descricao || null,
          categoryId: category?.id,
          sectorId: sector?.id,
          isActive: true,
          status: 'ACTIVE',
          isImported: true,
          allowEditValues,
          allowEditDescription,
          isService,
        },
      });
    } else {
      // Atualizar dados principais do produto existente
      product = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          name: row.nome,
          technicalDescription: row.descricao || null,
          categoryId: category?.id || product.categoryId,
          sectorId: sector?.id || product.sectorId,
          allowEditValues,
          allowEditDescription,
          isService,
        },
      });
    }

    // A planilha não tem colunas fiscais: garante dados fiscais com os
    // defaults da empresa (NCM/CFOP padrão), como no cadastro via tela.
    // Idempotente — produto que já tem cadastro fiscal não é tocado.
    try {
      await this.productFiscalService.getOrCreateWithDefaults(
        product.id,
        companyId,
      );
    } catch (error) {
      // Não-fatal: a importação do produto vale mesmo sem os dados fiscais
      console.error(
        `Failed to auto-populate fiscal data for imported product ${product.id}:`,
        error.message,
      );
    }

    // Criar item do produto (sempre criamos pelo menos 1 item para o produto importado)
    const itemName = row.nome;

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

    // "valorUnitario" = preço de venda por unidade de exibição → unitCost bruto (ex: R$/mm²)
    const displayUnitCost = this.toCents(row.valorUnitario);

    const rawUnitCost = convertDisplayToRaw(displayUnitCost, unitKind);

    // salePrice = total (unitCost × totalQuantity). Sem dimensões, será recalculado pelo frontend.
    // Se houver dimensões (largura × altura para AREA), calculamos aqui
    let salePrice: number | null = null;

    // O banco salva dimensões em milímetros. O CSV geralmente traz em metros (ex: 1,40).
    const parseDimension = (val: string | undefined): number | null => {
      if (!val) return null;
      const parsed = this.parseDecimal(val);
      return isNaN(parsed) ? null : parsed * 1000;
    };

    // Duração do CSV (horas) para o Banco (segundos)
    const parseDuration = (val: string | undefined): number | null => {
      if (!val) return null;
      const parsed = this.parseDecimal(val);
      return isNaN(parsed) ? null : parsed * 3600;
    };

    const widthMm = parseDimension(row.largura);
    const heightMm = parseDimension(row.altura);
    const durationSeconds = parseDuration(row.duracao);

    if (rawUnitCost && rawUnitCost > 0) {
      if (unitKind === 'AREA' && widthMm && heightMm) {
        salePrice = rawUnitCost * widthMm * heightMm;
      } else if (unitKind === 'DURATION' && durationSeconds) {
        salePrice = rawUnitCost * durationSeconds;
      } else if (!DIMENSIONAL_UNIT_KINDS.includes(unitKind)) {
        // Unidade sem dimensão (UN, PC…): o valor unitário já é o próprio total.
        salePrice = rawUnitCost;
      }
      // Unidade dimensional sem medida no CSV (ex.: produto por m² sem largura e
      // altura): não existe total a calcular. Gravar `rawUnitCost` aqui colocaria
      // uma taxa por unidade bruta (R$/mm², R$/segundo…) num campo de total, que a
      // listagem exibiria como 0,00. Fica null e o total é calculado no orçamento,
      // quando a medida é informada.
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
          duration: durationSeconds,
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
          duration: durationSeconds,
          unitCost: rawUnitCost,
          salePrice: salePrice,
          defaultUnitOfMeasureId: unitOfMeasureId,
          unitKind: unitKind,
        },
      });
    }
  }

  /**
   * Carrega as condições de pagamento da empresa uma única vez.
   */
  private async buildPaymentConditionIndex(
    companyId: string,
  ): Promise<PaymentConditionIndex> {
    const conditions = await this.prisma.paymentCondition.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const byLegacyId = new Map<string, any>();
    const byName = new Map<string, any[]>();

    for (const condition of conditions) {
      if (condition.legacyId) {
        byLegacyId.set(condition.legacyId.trim(), condition);
      }

      const key = condition.name?.trim().toLowerCase();
      if (!key) continue;
      const bucket = byName.get(key) || [];
      bucket.push(condition);
      byName.set(key, bucket);
    }

    return { byLegacyId, byName, fallback: conditions[0] || null };
  }

  /**
   * Resolve a condição de pagamento de uma linha.
   *
   * O legado repete nomes — "À prazo" existe com custo de 5,00% e de 3,90% — e
   * a busca anterior pegava o primeiro resultado, sem erro. As parcelas entravam
   * com o custo financeiro errado e nada indicava isso. Quando o nome é
   * ambíguo, agora a linha falha e pede o código do legado.
   */
  private resolvePaymentCondition(index: PaymentConditionIndex, row: any) {
    const legacyId = row.CondicaoPagamentoCodigoLegado?.trim();
    if (legacyId) {
      const byLegacy = index.byLegacyId.get(legacyId);
      if (!byLegacy) {
        throw new Error(
          `Condição de pagamento com código legado '${legacyId}' não encontrada`,
        );
      }
      return byLegacy;
    }

    const name = row.CondicaoPagamento?.trim();
    if (name) {
      const matches = index.byName.get(name.toLowerCase()) || [];

      if (matches.length > 1) {
        throw new Error(
          `Condição de pagamento '${name}' é ambígua (${matches.length} cadastradas com esse nome). ` +
            `Informe 'CondicaoPagamentoCodigoLegado' para escolher qual.`,
        );
      }

      if (matches.length === 1) return matches[0];
    }

    // Sem identificador utilizável: mantém o comportamento antigo de usar a
    // primeira condição ativa da empresa.
    return index.fallback;
  }

  /**
   * Carrega os clientes da empresa uma única vez e monta os índices de busca.
   *
   * A busca anterior caía num plano B que lia a base inteira de clientes a cada
   * linha sem casamento direto. Com 956 clientes, 2.176 vendas e 1.663
   * lançamentos financeiros, isso são milhões de registros materializados à toa.
   */
  private async buildClientIndex(companyId: string): Promise<ClientIndex> {
    const clients = await this.prisma.client.findMany({
      where: { companyId },
      select: { id: true, cpf: true, cnpj: true, legacyId: true },
    });

    const byLegacyId = new Map<string, any>();
    const byDocument = new Map<string, any>();

    for (const client of clients) {
      if (client.legacyId) {
        byLegacyId.set(client.legacyId.trim(), client);
      }

      const cpf = (client.cpf || '').replace(/[^\d]/g, '');
      if (cpf) byDocument.set(cpf, client);

      const cnpj = (client.cnpj || '').replace(/[^\d]/g, '');
      if (cnpj) byDocument.set(cnpj, client);
    }

    return { byLegacyId, byDocument };
  }

  /**
   * Resolve o cliente de uma linha do arquivo.
   *
   * O código do legado tem precedência sobre o documento: 29% dos clientes da
   * base legada não têm CPF nem CNPJ, e enquanto o documento era a única chave
   * possível, 408 vendas não tinham como ser vinculadas a ninguém.
   *
   * A comparação de documento é por dígitos, dos dois lados. A versão anterior
   * usava `contains`, que aceitava casamento parcial e podia trazer o cliente
   * errado quando um documento era substring de outro.
   */
  private resolveClient(index: ClientIndex, row: any) {
    const legacyId = row.ClienteCodigoLegado?.trim();
    if (legacyId) {
      return index.byLegacyId.get(legacyId) || null;
    }

    const document = (row.ClienteCpfCnpj || '').replace(/[^\d]/g, '');
    if (document) {
      return index.byDocument.get(document) || null;
    }

    return null;
  }

  private clientNotFoundMessage(row: any): string {
    const legacyId = row.ClienteCodigoLegado?.trim();
    if (legacyId) {
      return `Cliente com código legado '${legacyId}' não encontrado. Importe os clientes antes das vendas.`;
    }
    return `Cliente com CPF/CNPJ '${row.ClienteCpfCnpj}' não encontrado`;
  }

  /**
   * Alinha o contador de cada série ao maior número de orçamento já existente.
   *
   * A importação grava `quotationNumber` explícito, vindo do legado, mas quem
   * numera o próximo orçamento é `SaleSeries.currentBudgetNumber`. Sem este
   * ajuste, depois de importar um histórico que vai até 2196 a primeira venda
   * nova sai como número 1, colidindo com o histórico.
   *
   * O contador nunca recua: se já estiver à frente, fica como está.
   */
  private async syncSeriesBudgetNumbers(companyId: string): Promise<void> {
    const highestBySeries = await this.prisma.quotation.groupBy({
      by: ['seriesId'],
      where: { companyId, seriesId: { not: null } },
      _max: { quotationNumber: true },
    });

    for (const group of highestBySeries) {
      const highest = group._max?.quotationNumber;
      if (!highest || !group.seriesId) continue;

      const series = await this.prisma.saleSeries.findUnique({
        where: { id: group.seriesId },
        select: { currentBudgetNumber: true },
      });

      if (!series || series.currentBudgetNumber >= highest) continue;

      await this.prisma.saleSeries.update({
        where: { id: group.seriesId },
        data: { currentBudgetNumber: highest },
      });
    }
  }

  /**
   * Importar orçamentos do CSV (agrupa linhas por NumeroVenda)
   */
  private async importQuotations(
    rows: any[],
    companyId: string,
    options: { historySeries?: boolean } = {},
  ): Promise<{
    successCount: number;
    failedCount: number;
    skippedCount: number;
    errors: any[];
  }> {
    const errors: any[] = [];
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

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

    const clientIndex = await this.buildClientIndex(companyId);
    const paymentConditionIndex =
      await this.buildPaymentConditionIndex(companyId);

    // Processar cada orçamento
    for (const [key, items] of quotationsMap.entries()) {
      try {
        const firstItem = items[0];

        const legacyId = firstItem.VendaCodigoLegado?.trim() || null;

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

        // Sem esta checagem a importação de vendas não é idempotente: rodar de
        // novo cria documentos duplicados em vez de reconhecer os já migrados.
        // Reimportar um documento exige apagá-lo antes, porque as relações
        // filhas (itens, pagamento, entrega, ordem) não têm exclusão em cascata.
        if (legacyId) {
          const alreadyImported = await this.prisma.quotation.findFirst({
            where: { companyId, legacyId },
            select: { id: true },
          });

          if (alreadyImported) {
            const estado = await this.refreshImportedSale(alreadyImported.id, {
              hasOrder: false,
              totalValue: this.expectedSaleTotal(items),
              status,
            });

            if (estado === 'blocked') {
              failedCount++;
              errors.push({
                row: firstItem.rowNumber,
                error: `Orçamento ${key}: mudou no legado, mas já tem nota fiscal emitida no Atrupe. Ajuste manual.`,
              });
              continue;
            }

            if (estado === 'unchanged') {
              skippedCount++;
              continue;
            }

            // 'refreshed': o documento antigo foi apagado e é recriado abaixo
            // com o que o legado mostra hoje.
          }
        }

        // Buscar série
        const series = await this.resolveImportSeries(
          companyId,
          firstItem.Serie,
          options.historySeries,
        );

        // Buscar cliente pelo código do legado ou pelo CPF/CNPJ
        const client = this.resolveClient(clientIndex, firstItem);

        if (!client) {
          throw new Error(this.clientNotFoundMessage(firstItem));
        }

        // Buscar vendedor
        const seller = await this.findSeller(
          companyId,
          firstItem.VendedorEmail,
          firstItem.VendedorCodigoLegado,
        );

        if (!seller) {
          throw new Error(this.sellerNotFoundMessage(firstItem));
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
            // A referência da venda é o que o usuário reconhece no resumo;
            // a observação do item é detalhe interno e quase sempre vazia.
            description:
              firstItem.ReferenciaVenda || firstItem.ObservacaoItem || null,
            dueDate: firstItem.DataValidade
              ? this.toDayDate(firstItem.DataValidade)
              : null,
            // O documento migrado guarda a data que tinha no legado: as telas
            // agrupam e filtram por ela, e é ela que sai no PDF. Sem isto, todo
            // o histórico do cliente aparece no dia em que a migração rodou.
            createdAt: firstItem.DataVenda
              ? this.toDayDate(firstItem.DataVenda)
              : new Date(),
            // "Concluído" aqui é o orçamento fechado, que no Atrupe fica
            // aguardando aprovação — não é venda aprovada.
            approvedAt:
              status === 'APPROVED' && firstItem.DataVenda
                ? this.toDayDate(firstItem.DataVenda)
                : null,
            finishedAt: firstItem.DataConclusao
              ? this.toDayDate(firstItem.DataConclusao)
              : null,
            quotationNumber: parseInt(firstItem.NumeroVenda),
            legacyId,
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

          const {
            totalValue: itemTotalValue,
            discount,
            finalValue: itemFinalValue,
          } = this.lineValues(item);

          quotationTotalValue += itemFinalValue;

          // Criar QuotationProduct
          const quotationProduct = await this.prisma.quotationProduct.create({
            data: {
              quotationId: quotation.id,
              productId: product.id,
              quantity: parseInt(item.Quantidade),
              totalValue: itemTotalValue,
              finalValue: itemFinalValue,
              discount,
              // A referência da linha é o produto; a observação é detalhe e vai
              // para as anotações. Antes a observação ocupava a descrição, e a
              // coluna "Referência" da tela mostrava um texto longo no lugar do
              // nome do produto — divergindo do legado e da importação de ordens.
              description: item.ProdutoNome || product.name,
              notes: item.ObservacaoItem || null,
              technicalDescription: product.technicalDescription,
            },
          });

          // Criar QuotationProductItem para cada ProductItem
          if (product.items && product.items.length > 0) {
            const productItem = product.items[0]; // Usar o primeiro item como padrão

            // Medida da linha do documento; sem ela, cai na do produto.
            const itemWidth =
              this.toMillimeters(item.ItemLargura) ?? productItem.width;
            const itemHeight =
              this.toMillimeters(item.ItemComprimento) ?? productItem.height;

            await this.prisma.quotationProductItem.create({
              data: {
                quotationId: quotation.id,
                productId: product.id,
                quotationProductId: quotationProduct.id,
                productItemId: productItem.id,
                // A tela multiplica a quantidade da composição pela da linha.
                // Repetir a quantidade aqui elevava a medida ao quadrado: 250
                // unidades viravam 62.500.
                quantity: 1,
                name: productItem.name,
                // Total da linha, não o valor unitário: é o que a tela divide
                // pela medida total para chegar à taxa.
                salePrice: itemTotalValue,
                unitCost: this.unitCostForLine(
                  itemTotalValue,
                  productItem.unitKind,
                  {
                    width: itemWidth,
                    height: itemHeight,
                    length: productItem.length,
                    duration: productItem.duration,
                  },
                  parseInt(item.Quantidade),
                ),
                totalValue: itemTotalValue,
                width:
                  this.toMillimeters(item.ItemLargura) ?? productItem.width,
                height:
                  this.toMillimeters(item.ItemComprimento) ??
                  productItem.height,
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
              ? this.toDayDate(firstItem.DataEntrega)
              : null,
          },
        });

        // === CRIAR QUOTATION PAYMENT E PARCELAS ===
        const paymentCondition = this.resolvePaymentCondition(
          paymentConditionIndex,
          firstItem,
        );

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

    await this.syncSeriesBudgetNumbers(companyId);

    return { successCount, failedCount, skippedCount, errors };
  }

  /**
   * Importar ordens de serviço (múltiplas linhas por ordem)
   * Inclui criação de lançamentos financeiros (receitas e despesas)
   */
  /**
   * @param options.skipReceivable não cria o contas a receber da ordem.
   *
   * Usado pela migração do legado: lá o recebível vem do próprio financeiro do
   * sistema antigo, com as parcelas, vencimentos e pagamentos reais. Deixar a
   * ordem sintetizar um recebível de 30 dias dobraria o valor a receber.
   */
  private async importOrders(
    rows: any[],
    companyId: string,
    options: { skipReceivable?: boolean; historySeries?: boolean } = {},
  ) {
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
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

    const clientIndex = await this.buildClientIndex(companyId);
    const paymentConditionIndex =
      await this.buildPaymentConditionIndex(companyId);

    // Processar cada ordem
    for (const [key, items] of ordersMap) {
      try {
        const firstItem = items[0];

        const legacyId = firstItem.VendaCodigoLegado?.trim() || null;

        // Sem esta checagem a importação de vendas não é idempotente: rodar de
        // novo cria documentos duplicados em vez de reconhecer os já migrados.
        // Reimportar um documento exige apagá-lo antes, porque as relações
        // filhas (itens, pagamento, entrega, ordem) não têm exclusão em cascata.
        if (legacyId) {
          const alreadyImported = await this.prisma.quotation.findFirst({
            where: { companyId, legacyId },
            select: { id: true },
          });

          if (alreadyImported) {
            const estado = await this.refreshImportedSale(alreadyImported.id, {
              hasOrder: true,
              totalValue: this.expectedSaleTotal(items),
            });

            if (estado === 'blocked') {
              failedCount++;
              errors.push({
                row: firstItem.rowNumber,
                error: `Ordem ${key}: mudou no legado, mas já tem nota fiscal emitida no Atrupe. Ajuste manual.`,
              });
              continue;
            }

            if (estado === 'unchanged') {
              skippedCount++;
              continue;
            }

            // 'refreshed': o documento antigo foi apagado e é recriado abaixo
            // com o que o legado mostra hoje.
          }
        }

        // Buscar série
        const series = await this.resolveImportSeries(
          companyId,
          firstItem.Serie,
          options.historySeries,
        );

        // Buscar cliente pelo código do legado ou pelo CPF/CNPJ
        const client = this.resolveClient(clientIndex, firstItem);

        if (!client) {
          throw new Error(this.clientNotFoundMessage(firstItem));
        }

        // Buscar vendedor
        const employee = await this.findSeller(
          companyId,
          firstItem.VendedorEmail,
          firstItem.VendedorCodigoLegado,
        );

        if (!employee) {
          throw new Error(this.sellerNotFoundMessage(firstItem));
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
              ? this.toDayDate(firstItem.DataVenda)
              : new Date(),
            createdAt: firstItem.DataVenda
              ? this.toDayDate(firstItem.DataVenda)
              : new Date(),
            dueDate: firstItem.DataValidade
              ? this.toDayDate(firstItem.DataValidade)
              : null,
            clientId: client.id,
            sellerId: employee.id,
            contactId,
            companyId,
            description: firstItem.ReferenciaVenda || null,
            legacyId,
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

          const quantity = this.parseDecimal(item.Quantidade) || 0;
          const {
            totalValue: itemTotalValue,
            discount,
            finalValue: itemFinalValue,
          } = this.lineValues(item);

          quotationTotalValue += itemFinalValue;

          // Criar produto do orçamento
          const quotationProduct = await this.prisma.quotationProduct.create({
            data: {
              quotationId: quotation.id,
              productId: product.id,
              description: item.ProdutoNome || product.name,
              quantity,
              totalValue: itemTotalValue,
              finalValue: itemFinalValue,
              discount,
              notes: item.ObservacaoItem || null,
            },
          });

          // Criar itens do produto (se o produto tiver items)
          for (const productItem of product.items) {
            // Medida da linha do documento; sem ela, cai na do produto.
            const itemWidth =
              this.toMillimeters(item.ItemLargura) ?? productItem.width;
            const itemHeight =
              this.toMillimeters(item.ItemComprimento) ?? productItem.height;

            await this.prisma.quotationProductItem.create({
              data: {
                quotationProductId: quotationProduct.id,
                quotationId: quotation.id,
                productId: product.id,
                productItemId: productItem.id,
                name: productItem.name,
                quantity: 1,
                // Valor da venda, não o do catálogo: o preço praticado no
                // documento histórico é o que o cliente reconhece, e pode ser
                // bem diferente do preço atual do produto.
                unitCost: this.unitCostForLine(
                  itemTotalValue,
                  productItem.unitKind,
                  {
                    width: itemWidth,
                    height: itemHeight,
                    length: productItem.length,
                    duration: productItem.duration,
                  },
                  quantity,
                ),
                salePrice: itemTotalValue,
                totalValue: itemTotalValue,
                width:
                  this.toMillimeters(item.ItemLargura) ?? productItem.width,
                height:
                  this.toMillimeters(item.ItemComprimento) ??
                  productItem.height,
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
              ? this.toDayDate(firstItem.DataEntrega)
              : null,
          },
        });

        // === CRIAR QUOTATION PAYMENT E PARCELAS ===
        const paymentCondition = this.resolvePaymentCondition(
          paymentConditionIndex,
          firstItem,
        );

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
            if (!options.skipReceivable)
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
        if (
          comissaoValor > 0 &&
          (firstItem.ComissaoVendedorCodigoLegado ||
            firstItem.ComissaoFornecedorCpfCnpj)
        ) {
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
            // A lista de O.S. agrupa por esta data. Sem ela, a ordem migrada
            // cai no dia da migração, e não no dia em que a venda aconteceu.
            createdAt: firstItem.DataVenda
              ? this.toDayDate(firstItem.DataVenda)
              : new Date(),
            deliveredAt:
              firstItem.DataEntrega && orderStatus === 'FINISHED'
                ? this.toDayDate(firstItem.DataEntrega)
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

    await this.syncSeriesBudgetNumbers(companyId);

    return { successCount, failedCount, skippedCount, errors };
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
          createdAt: quotation.createdAt,
          description: `Entrada da venda ${quotation.quotationNumber}-${series.code}`,
          isImported: true,
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
        createdAt: quotation.createdAt,
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
        createdAt: quotation.createdAt,
        description: `Frete da venda ${quotation.quotationNumber}-${series.code}`,
        isImported: true,
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
    // O comissionado pode ser um colaborador da casa ou um fornecedor externo.
    // No legado da base piloto os 1.840 registros de comissão apontam para
    // colaborador, então o código do vendedor tem precedência.
    const sellerLegacyId = firstItem.ComissaoVendedorCodigoLegado?.trim();

    let employee: any = null;
    let supplier: any = null;

    if (sellerLegacyId) {
      employee = await this.prisma.employee.findFirst({
        where: { companyId, legacyId: sellerLegacyId },
      });

      if (!employee) {
        throw new Error(
          `Comissionado com código legado '${sellerLegacyId}' não encontrado. Importe os colaboradores antes das vendas.`,
        );
      }
    } else {
      const cleanCpfCnpj = (firstItem.ComissaoFornecedorCpfCnpj || '').replace(
        /[^\d]/g,
        '',
      );

      supplier = await this.prisma.supplier.findFirst({
        where: {
          companyId,
          OR: [
            { cpf: { contains: cleanCpfCnpj } },
            { cnpj: { contains: cleanCpfCnpj } },
          ],
        },
      });

      // Antes isto apenas registrava um aviso e devolvia null, descartando a
      // comissão em silêncio. Numa migração que traz R$ 464 mil em comissão,
      // perder o lançamento sem erro visível é pior do que recusar a linha.
      if (!supplier) {
        throw new Error(
          `Comissionado com CPF/CNPJ '${firstItem.ComissaoFornecedorCpfCnpj}' não encontrado`,
        );
      }
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
        createdAt: quotation.createdAt,
        description: `Comissão da venda ${quotation.quotationNumber}-${series.code}`,
        isImported: true,
        totalAmount: comissaoValor,
        totalValue: comissaoValor,
        installmentQty: 1,
        status: 'PENDING',
        supplierId: supplier?.id || null,
        employeeId: employee?.id || null,
        expenseSource: employee ? 'EMPLOYEE' : 'SUPPLIER',
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
    const skippedCount = 0;
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

    const clientIndex = await this.buildClientIndex(companyId);
    const paymentConditionIndex =
      await this.buildPaymentConditionIndex(companyId);

    // Processar cada lançamento
    for (const [key, installments] of financialMap) {
      try {
        const firstItem = installments[0];
        const isReceivable = firstItem.Tipo.toUpperCase() === 'RECEITA';

        // Buscar cliente (se for receita)
        let clientId: string | null = null;
        if (isReceivable && firstItem.ClienteCpfCnpj) {
          const client = this.resolveClient(clientIndex, firstItem);

          if (!client) {
            throw new Error(this.clientNotFoundMessage(firstItem));
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
          const nature = await findActiveNatureByDescription(
            this.prisma,
            companyId,
            firstItem.Natureza,
          );
          // Sem classificação o lançamento ainda vale: perder o valor
          // financeiro é pior do que perder a natureza, que o usuário
          // reclassifica depois. O mesmo critério vale na validação.
          natureId = nature?.id ?? null;
        }

        // Buscar subcategoria
        let subCategoryId: string | null = null;
        if (firstItem.SubCategoria) {
          const subCategory = await findActiveSubCategoryByDescription(
            this.prisma,
            companyId,
            firstItem.SubCategoria,
            natureId,
          );
          subCategoryId = subCategory?.id ?? null;
        }

        const totalAmount = this.toCents(firstItem.ValorTotal) || 0;
        const referenceDate = firstItem.DataReferencia
          ? this.toDayDate(firstItem.DataReferencia)
          : new Date();

        if (isReceivable) {
          // Obter primeiro vencimento para verificação de duplicata
          const firstDueDate = installments[0]?.DataVencimento
            ? new Date(installments[0].DataVencimento)
            : null;

          // Verificar se já existe Receivable similar (evitar duplicatas)
          // A descrição entra na chave porque `clientId: undefined` remove o
          // filtro em vez de exigir nulo: sem ela, dois lançamentos distintos
          // sem cliente, de mesmo valor e mesma data, eram tratados como
          // duplicata e o segundo sumia — contado como sucesso.
          const existingReceivable = await this.prisma.receivable.findFirst({
            where: {
              companyId,
              description: firstItem.Descricao,
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
              createdAt: referenceDate,
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
              ? this.toDayDate(item.DataVencimento)
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
            if (item.CondicaoPagamento || item.CondicaoPagamentoCodigoLegado) {
              const paymentCondition = this.resolvePaymentCondition(
                paymentConditionIndex,
                item,
              );
              if (paymentCondition) {
                paymentConditionId = paymentCondition.id;
              }
            }

            // Buscar conta bancária
            let bankAccountId: string | null = null;
            if (item.ContaBancaria) {
              const bankAccount = await findActiveBankAccountByName(
                this.prisma,
                companyId,
                item.ContaBancaria,
              );
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
                    ? this.toDayDate(item.DataPagamento)
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
              createdAt: referenceDate,
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
              ? this.toDayDate(item.DataVencimento)
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
            if (item.CondicaoPagamento || item.CondicaoPagamentoCodigoLegado) {
              const paymentCondition = this.resolvePaymentCondition(
                paymentConditionIndex,
                item,
              );
              if (paymentCondition) {
                paymentConditionId = paymentCondition.id;
              }
            }

            // Buscar conta bancária
            let bankAccountId: string | null = null;
            if (item.ContaBancaria) {
              const bankAccount = await findActiveBankAccountByName(
                this.prisma,
                companyId,
                item.ContaBancaria,
              );
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
                    ? this.toDayDate(item.DataPagamento)
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

    return { successCount, failedCount, skippedCount, errors };
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

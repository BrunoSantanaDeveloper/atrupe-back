import { Injectable } from '@nestjs/common';
import {
  NfceStatus,
  NfeStatus,
  NfseStatus,
  OrderStatus,
  PaymentStatus,
  QuotationStatus,
} from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { AiRequestUser } from './ai.types';

type OperationalEntity =
  | 'orders'
  | 'quotations'
  | 'receivables'
  | 'payables'
  | 'nfes'
  | 'nfses'
  | 'nfces';
type OperationalMetric = 'count' | 'sum';
type ToolArgs = Record<string, unknown>;
const PROJECT_TIMEZONE_OFFSET = '-03:00';
const PROJECT_TIMEZONE = 'America/Sao_Paulo';

interface OperationalCatalogEntry {
  permission: string;
  additionalPermissions?: string[];
  domain: 'sales' | 'financial' | 'fiscal';
  statuses: string[];
  dateFields: string[];
  defaultDateField: string;
  labels: Record<string, string>;
}

export class AiOperationalQueryDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

@Injectable()
export class AiOperationalQueryService {
  private readonly catalog: Record<OperationalEntity, OperationalCatalogEntry> =
    {
      orders: {
        permission: 'sale:order',
        domain: 'sales',
        statuses: Object.values(OrderStatus),
        dateFields: ['createdAt', 'updatedAt', 'canceledAt', 'deliveredAt'],
        defaultDateField: 'createdAt',
        labels: {
          PENDING: 'Pendentes',
          IN_PRODUCTION: 'Em producao',
          DELIVERY: 'Em entrega',
          COMPLETED: 'Concluidas',
          CANCELED: 'Canceladas',
          FINISHED: 'Finalizadas',
        },
      },
      quotations: {
        permission: 'sale:quotation',
        domain: 'sales',
        statuses: Object.values(QuotationStatus),
        dateFields: ['createdAt', 'updatedAt', 'dueDate'],
        defaultDateField: 'createdAt',
        labels: {
          APPROVED: 'Aprovados',
          OPEN: 'Abertos',
          CLOSED: 'Fechados',
          CANCELED: 'Cancelados',
          REJECTED: 'Rejeitados',
          DONE: 'Concluidos',
          OVERDUE: 'Vencidos',
        },
      },
      receivables: {
        permission: 'financial:flow',
        additionalPermissions: ['values:values'],
        domain: 'financial',
        statuses: Object.values(PaymentStatus),
        dateFields: ['dueDate', 'paidDate', 'createdAt', 'updatedAt'],
        defaultDateField: 'dueDate',
        labels: {
          PENDING: 'Pendentes',
          PAID: 'Recebidas',
          OVERDUE: 'Vencidas',
          CANCELED: 'Canceladas',
          PROVISIONED: 'Provisionadas',
        },
      },
      payables: {
        permission: 'financial:flow',
        additionalPermissions: ['values:values'],
        domain: 'financial',
        statuses: Object.values(PaymentStatus),
        dateFields: ['dueDate', 'paidDate', 'createdAt', 'updatedAt'],
        defaultDateField: 'dueDate',
        labels: {
          PENDING: 'Pendentes',
          PAID: 'Pagas',
          OVERDUE: 'Vencidas',
          CANCELED: 'Canceladas',
          PROVISIONED: 'Provisionadas',
        },
      },
      nfes: {
        permission: 'nota_fiscal:emitidas',
        domain: 'fiscal',
        statuses: Object.values(NfeStatus),
        dateFields: [
          'createdAt',
          'updatedAt',
          'dataEmissao',
          'dataAutorizacao',
          'dataCancelamento',
        ],
        defaultDateField: 'createdAt',
        labels: {
          DRAFT: 'Em digitacao',
          PENDING: 'Pendentes',
          PROCESSING: 'Em processamento',
          AUTHORIZED: 'Autorizadas',
          REJECTED: 'Rejeitadas',
          CANCELLED: 'Canceladas',
          CORRECTION_SENT: 'Com carta de correcao',
        },
      },
      nfses: {
        permission: 'nota_fiscal:emitidas',
        domain: 'fiscal',
        statuses: Object.values(NfseStatus),
        dateFields: [
          'createdAt',
          'updatedAt',
          'dataEmissao',
          'dataCompetencia',
          'dataCancelamento',
        ],
        defaultDateField: 'createdAt',
        labels: {
          DRAFT: 'Em digitacao',
          PENDING: 'Pendentes',
          PROCESSING: 'Em processamento',
          AUTHORIZED: 'Autorizadas',
          REJECTED: 'Rejeitadas',
          CANCELLED: 'Canceladas',
        },
      },
      nfces: {
        permission: 'nota_fiscal:emitidas',
        domain: 'fiscal',
        statuses: Object.values(NfceStatus),
        dateFields: [
          'createdAt',
          'updatedAt',
          'dataEmissao',
          'dataAutorizacao',
          'dataCancelamento',
        ],
        defaultDateField: 'createdAt',
        labels: {
          PENDING: 'Pendentes',
          PROCESSING: 'Em processamento',
          AUTHORIZED: 'Autorizadas',
          REJECTED: 'Rejeitadas',
          CANCELLED: 'Canceladas',
          CONTINGENCY: 'Em contingencia',
        },
      },
    };

  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  getToolSchema() {
    return {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: Object.keys(this.catalog),
          description: 'Entidade de negocio consultada.',
        },
        metric: {
          type: 'string',
          enum: ['count', 'sum'],
          description:
            'Metrica agregada solicitada. sum e permitido apenas para recebiveis e despesas.',
        },
        groupBy: {
          type: 'string',
          enum: ['status'],
          description:
            'Agrupamento opcional. Use status para totais por situacao.',
        },
        filters: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
            dateField: {
              type: 'string',
              enum: [
                'createdAt',
                'updatedAt',
                'canceledAt',
                'deliveredAt',
                'dueDate',
                'paidDate',
                'dataEmissao',
                'dataAutorizacao',
                'dataCompetencia',
                'dataCancelamento',
              ],
            },
            sellerId: { type: 'string' },
            clientId: { type: 'string' },
            supplierId: { type: 'string' },
            serieId: { type: 'string' },
            paymentConditionId: { type: 'string' },
            bankAccountId: { type: 'string' },
          },
        },
      },
      required: ['entity', 'metric'],
    };
  }

  getSearchToolSchema() {
    return {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: Object.keys(this.catalog),
        },
        filters: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            status: { type: 'string' },
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD' },
            dateField: { type: 'string' },
            sellerId: { type: 'string' },
            clientId: { type: 'string' },
            supplierId: { type: 'string' },
            serieId: { type: 'string' },
            paymentConditionId: { type: 'string' },
            bankAccountId: { type: 'string' },
          },
        },
        limit: {
          type: 'number',
          description: 'Quantidade maxima de registros retornados. Maximo 10.',
        },
      },
      required: ['entity'],
    };
  }

  getDetailsToolSchema() {
    return {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: Object.keys(this.catalog),
        },
        id: {
          type: 'string',
          description: 'ID do registro retornado por uma busca.',
        },
      },
      required: ['entity', 'id'],
    };
  }

  async query(args: ToolArgs, user: AiRequestUser) {
    if (!user.companyId) {
      throw new AiOperationalQueryDeniedError('Usuario sem empresa ativa.');
    }

    const entity = this.normalizeEntity(args.entity);
    const metric = this.normalizeMetric(args.metric, entity);
    const filters = this.cleanFilters(args.filters);
    const catalogEntry = this.catalog[entity];
    this.applyFinancialPeriodDefaults(catalogEntry, filters);

    await this.ensurePermissions(user, catalogEntry);
    await this.enforceScope(user, catalogEntry, filters);

    if (catalogEntry.domain === 'financial') {
      return this.aggregateFinancial(entity, catalogEntry, filters, metric);
    }

    if (metric === 'count') {
      return this.count(entity, catalogEntry, filters);
    }
  }

  async search(args: ToolArgs, user: AiRequestUser) {
    if (!user.companyId) {
      throw new AiOperationalQueryDeniedError('Usuario sem empresa ativa.');
    }

    const entity = this.normalizeEntity(args.entity);
    const filters = this.cleanFilters(args.filters);
    const catalogEntry = this.catalog[entity];
    this.applyFinancialPeriodDefaults(catalogEntry, filters);
    const status = this.normalizeStatus(filters.status, catalogEntry.statuses);
    const dateField = this.normalizeDateField(
      filters.dateField,
      catalogEntry.dateFields,
      catalogEntry.defaultDateField,
    );
    const limit = this.normalizeLimit(args.limit);

    await this.ensurePermissions(user, catalogEntry);
    await this.enforceScope(user, catalogEntry, filters);

    const where = this.buildWhere(entity, filters, status, dateField);
    const records = await this.findRecords(entity, where, limit, status);

    return {
      entity,
      filters: {
        search: filters.search || null,
        status: status || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      },
      limit,
      records: records.map((record) => this.formatRecord(entity, record)),
    };
  }

  async details(args: ToolArgs, user: AiRequestUser) {
    if (!user.companyId) {
      throw new AiOperationalQueryDeniedError('Usuario sem empresa ativa.');
    }

    const entity = this.normalizeEntity(args.entity);
    const id = String(args.id || '').trim();
    if (!id) throw new Error('ID operacional obrigatorio.');

    const catalogEntry = this.catalog[entity];
    const filters: ToolArgs = {};
    await this.ensurePermissions(user, catalogEntry);
    await this.enforceScope(user, catalogEntry, filters);

    const where = {
      ...this.buildWhere(
        entity,
        filters,
        undefined,
        catalogEntry.defaultDateField,
        true,
      ),
      id,
    };
    const record = await this.findRecord(entity, where);

    return {
      entity,
      record: record ? this.formatRecord(entity, record) : null,
    };
  }

  private async count(
    entity: OperationalEntity,
    catalogEntry: OperationalCatalogEntry,
    filters: ToolArgs,
  ) {
    const requestedStatus = this.normalizeStatus(
      filters.status,
      catalogEntry.statuses,
    );
    const dateField = this.normalizeDateField(
      filters.dateField,
      catalogEntry.dateFields,
      catalogEntry.defaultDateField,
    );
    const where = this.buildWhere(entity, filters, requestedStatus, dateField);
    const grouped =
      entity === 'orders'
        ? await this.prisma.order.groupBy({
            by: ['status'],
            where,
            _count: true,
          })
        : entity === 'quotations'
          ? await this.prisma.quotation.groupBy({
              by: ['status'],
              where,
              _count: true,
            })
          : await this.fiscalModel(entity).groupBy({
              by: ['status'],
              where,
              _count: true,
            });

    const counts = catalogEntry.statuses
      .filter((status) => !requestedStatus || status === requestedStatus)
      .map((status) => ({
        status,
        label: catalogEntry.labels[status] || status,
        count: grouped.find((item) => item.status === status)?._count || 0,
      }));

    return {
      entity,
      metric: 'count',
      groupBy: 'status',
      dateField,
      period: {
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      },
      filters: {
        status: requestedStatus || null,
      },
      counts,
      total: counts.reduce((total, item) => total + item.count, 0),
    };
  }

  private async aggregateFinancial(
    entity: OperationalEntity,
    catalogEntry: OperationalCatalogEntry,
    filters: ToolArgs,
    metric: OperationalMetric,
  ) {
    const requestedStatus = this.normalizeStatus(
      filters.status,
      catalogEntry.statuses,
    );
    const dateField = this.normalizeDateField(
      filters.dateField,
      catalogEntry.dateFields,
      catalogEntry.defaultDateField,
    );
    const records = await this.financialModel(entity).findMany({
      where: this.buildWhere(entity, filters, requestedStatus, dateField),
      select: this.financialInstallmentSelect(entity),
    });
    const filteredRecords = records.filter(
      (record) =>
        !requestedStatus ||
        this.getFinancialInstallmentStatus(record) === requestedStatus,
    );
    const totals = catalogEntry.statuses
      .filter((status) => !requestedStatus || status === requestedStatus)
      .map((status) => {
        const statusRecords = filteredRecords.filter(
          (record) => this.getFinancialInstallmentStatus(record) === status,
        );
        return {
          status,
          label: catalogEntry.labels[status] || status,
          count: statusRecords.length,
          value: statusRecords.reduce(
            (total, record) => total + this.getFinancialValue(record),
            0,
          ),
        };
      });
    const totalCount = totals.reduce((total, item) => total + item.count, 0);
    const totalValue = totals.reduce((total, item) => total + item.value, 0);

    return {
      entity,
      metric,
      groupBy: 'status',
      dateField,
      period: {
        startDate: filters.startDate || null,
        endDate: filters.endDate || null,
      },
      filters: {
        status: requestedStatus || null,
      },
      totals,
      totalCount,
      totalValue,
      total: metric === 'count' ? totalCount : totalValue,
    };
  }

  private buildWhere(
    entity: OperationalEntity,
    filters: ToolArgs,
    status: string | undefined,
    dateField: string,
    includeCanceled = false,
  ) {
    if (this.catalog[entity].domain === 'financial') {
      return this.buildFinancialWhere(
        entity,
        filters,
        status,
        dateField,
        includeCanceled,
      );
    }
    if (this.catalog[entity].domain === 'fiscal') {
      return this.buildFiscalWhere(entity, filters, status, dateField);
    }

    const commonFilters = {
      ...(filters.sellerId ? { sellerId: String(filters.sellerId) } : {}),
      ...(filters.clientId ? { clientId: String(filters.clientId) } : {}),
      ...(filters.serieId ? { seriesId: String(filters.serieId) } : {}),
    };
    const where: any =
      entity === 'orders'
        ? {
            isActive: true,
            quotation: {
              companyId: String(filters.companyId),
              ...commonFilters,
            },
          }
        : {
            isActive: true,
            companyId: String(filters.companyId),
            ...commonFilters,
          };

    if (status) where.status = status;
    this.applySearch(where, entity, filters.search);
    this.applyDateRange(where, dateField, filters);
    return where;
  }

  private buildFiscalWhere(
    entity: OperationalEntity,
    filters: ToolArgs,
    status: string | undefined,
    dateField: string,
  ) {
    const where: any = {
      companyId: String(filters.companyId),
    };

    if (status) where.status = status;
    this.applyFiscalSearch(where, filters.search);
    this.applyDateRange(where, dateField, filters);
    return where;
  }

  private buildFinancialWhere(
    entity: OperationalEntity,
    filters: ToolArgs,
    status: string | undefined,
    dateField: string,
    includeCanceled: boolean,
  ) {
    const parentKey = entity === 'receivables' ? 'receivable' : 'payable';
    const parentFilters = {
      companyId: String(filters.companyId),
      status: { not: 'CANCELED' },
      ...(entity === 'receivables' && filters.clientId
        ? { clientId: String(filters.clientId) }
        : {}),
      ...(entity === 'payables' && filters.supplierId
        ? { supplierId: String(filters.supplierId) }
        : {}),
    };
    const where: any = {
      [parentKey]: parentFilters,
      ...(filters.paymentConditionId
        ? { paymentConditionId: String(filters.paymentConditionId) }
        : {}),
      ...(filters.bankAccountId
        ? { bankAccountId: String(filters.bankAccountId) }
        : {}),
    };

    if (
      status === 'PAID' ||
      status === 'PROVISIONED' ||
      status === 'CANCELED'
    ) {
      where.status = status;
    } else if (!includeCanceled) {
      where.status = { not: 'CANCELED' };
    }
    this.applyFinancialSearch(where, entity, filters.search);
    this.applyDateRange(where, dateField, filters);
    return where;
  }

  private cleanFilters(value: unknown): ToolArgs {
    const filters =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as ToolArgs)
        : {};
    const allowedKeys = [
      'status',
      'search',
      'startDate',
      'endDate',
      'dateField',
      'sellerId',
      'clientId',
      'supplierId',
      'serieId',
      'paymentConditionId',
      'bankAccountId',
    ];

    return Object.fromEntries(
      Object.entries(filters).filter(
        ([key, item]) =>
          allowedKeys.includes(key) &&
          item !== undefined &&
          item !== null &&
          item !== '',
      ),
    );
  }

  private async ensurePermissions(
    user: AiRequestUser,
    catalogEntry: OperationalCatalogEntry,
  ) {
    await this.ensurePermission(user, catalogEntry.permission);
    for (const permission of catalogEntry.additionalPermissions || []) {
      await this.ensurePermission(user, permission);
    }
  }

  private async ensurePermission(user: AiRequestUser, permission: string) {
    const allowed = await this.abacService.hasPermission(
      user,
      'view',
      permission,
    );
    if (!allowed) {
      throw new AiOperationalQueryDeniedError(
        'Seu perfil nao possui permissao para realizar essa consulta.',
      );
    }
  }

  private async enforceScope(
    user: AiRequestUser,
    catalogEntry: OperationalCatalogEntry,
    filters: ToolArgs,
  ) {
    filters.companyId = user.companyId;
    if (catalogEntry.domain !== 'sales') return;

    const canSeeOtherSellers =
      await this.abacService.canAccessOtherSellers(user);
    if (!canSeeOtherSellers && !user.isAdmin && user.employeeId) {
      filters.sellerId = user.employeeId;
    }
  }

  private applyDateRange(where: any, dateField: string, filters: ToolArgs) {
    const range: Record<string, Date> = {};
    if (filters.startDate)
      range.gte = this.parseProjectDate(String(filters.startDate), false);
    if (filters.endDate)
      range.lte = this.parseProjectDate(String(filters.endDate), true);
    if (Object.keys(range).length) where[dateField] = range;
  }

  private applyFinancialPeriodDefaults(
    catalogEntry: OperationalCatalogEntry,
    filters: ToolArgs,
  ) {
    if (
      catalogEntry.domain !== 'financial' ||
      filters.startDate ||
      filters.endDate
    ) {
      return;
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: PROJECT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const paddedMonth = String(month).padStart(2, '0');
    const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    filters.startDate = `${year}-${paddedMonth}-01`;
    filters.endDate = `${year}-${paddedMonth}-${String(endDay).padStart(2, '0')}`;
  }

  private applySearch(where: any, entity: OperationalEntity, value: unknown) {
    const search = String(value || '').trim();
    if (!search) return;

    const conditions: any[] = [
      { description: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
    ];
    const searchNumber = Number(search.split('-').pop()?.trim());
    if (Number.isInteger(searchNumber)) {
      conditions.push({ quotationNumber: searchNumber });
    }

    if (entity === 'orders') {
      where.quotation.OR = conditions;
    } else {
      where.OR = conditions;
    }
  }

  private applyFinancialSearch(
    where: any,
    entity: OperationalEntity,
    value: unknown,
  ) {
    const search = String(value || '').trim();
    if (!search) return;

    const parentKey = entity === 'receivables' ? 'receivable' : 'payable';
    const relationKey = entity === 'receivables' ? 'client' : 'supplier';
    where[parentKey].OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
      {
        [relationKey]: { name: { contains: search, mode: 'insensitive' } },
      },
    ];
  }

  private applyFiscalSearch(where: any, value: unknown) {
    const search = String(value || '').trim();
    if (!search) return;

    const number = Number(search);
    if (!Number.isInteger(number) || number < 0) {
      throw new Error('Busca fiscal permitida apenas pelo numero da nota.');
    }
    where.numero = number;
  }

  private async findRecords(
    entity: OperationalEntity,
    where: any,
    limit: number,
    status?: string,
  ) {
    if (entity === 'orders') {
      return this.prisma.order.findMany({
        where,
        select: this.orderSelect(),
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
    if (entity === 'quotations') {
      return this.prisma.quotation.findMany({
        where,
        select: this.quotationSelect(),
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
    if (this.catalog[entity].domain === 'fiscal') {
      return this.fiscalModel(entity).findMany({
        where,
        select: this.fiscalDocumentSelect(entity),
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    const records = await this.financialModel(entity).findMany({
      where,
      select: this.financialInstallmentSelect(entity, true),
      orderBy: { dueDate: 'asc' },
      take: Math.min(limit * 5, 50),
    });
    return records
      .filter(
        (record) =>
          !status || this.getFinancialInstallmentStatus(record) === status,
      )
      .slice(0, limit);
  }

  private async findRecord(entity: OperationalEntity, where: any) {
    if (entity === 'orders') {
      return this.prisma.order.findFirst({
        where,
        select: this.orderSelect(),
      });
    }
    if (entity === 'quotations') {
      return this.prisma.quotation.findFirst({
        where,
        select: this.quotationSelect(),
      });
    }
    if (this.catalog[entity].domain === 'fiscal') {
      return this.fiscalModel(entity).findFirst({
        where,
        select: this.fiscalDocumentSelect(entity),
      });
    }
    return this.financialModel(entity).findFirst({
      where,
      select: this.financialInstallmentSelect(entity, true),
    });
  }

  private financialModel(entity: OperationalEntity): any {
    if (entity === 'receivables') return this.prisma.receivableInstallment;
    if (entity === 'payables') return this.prisma.payableInstallment;
    throw new Error('Entidade financeira nao permitida.');
  }

  private fiscalModel(entity: OperationalEntity): any {
    if (entity === 'nfes') return this.prisma.nfe;
    if (entity === 'nfses') return this.prisma.nfse;
    if (entity === 'nfces') return this.prisma.nfce;
    throw new Error('Entidade fiscal nao permitida.');
  }

  private fiscalDocumentSelect(entity: OperationalEntity) {
    return {
      id: true,
      numero: true,
      serie: true,
      status: true,
      ambiente: true,
      createdAt: true,
      dataEmissao: true,
      dataCancelamento: true,
      motivoRejeicao: true,
      motivoCancelamento: true,
      orderId: true,
      quotationId: true,
      ...(entity !== 'nfses' ? { dataAutorizacao: true } : {}),
      ...(entity === 'nfses' ? { dataCompetencia: true } : {}),
      ...(entity === 'nfces' ? { contingencia: true } : {}),
    };
  }

  private financialInstallmentSelect(
    entity: OperationalEntity,
    withParent = false,
  ) {
    return {
      id: true,
      installmentNumber: true,
      status: true,
      dueDate: true,
      paidDate: true,
      provisionDate: true,
      amount: true,
      paidAmount: true,
      additionalFee: true,
      ...(withParent
        ? {
            ...(entity === 'receivables'
              ? {
                  receivable: {
                    select: {
                      id: true,
                      description: true,
                      reference: true,
                      client: { select: { id: true, name: true } },
                    },
                  },
                }
              : {
                  payable: {
                    select: {
                      id: true,
                      description: true,
                      reference: true,
                      supplier: { select: { id: true, name: true } },
                    },
                  },
                }),
          }
        : {}),
    };
  }

  private orderSelect() {
    return {
      id: true,
      status: true,
      createdAt: true,
      canceledAt: true,
      deliveredAt: true,
      quotation: {
        select: this.quotationSelect(),
      },
    };
  }

  private quotationSelect() {
    return {
      id: true,
      quotationNumber: true,
      description: true,
      status: true,
      createdAt: true,
      dueDate: true,
      client: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
    };
  }

  private formatRecord(entity: OperationalEntity, record: any) {
    if (entity === 'orders') {
      return {
        id: record.id,
        status: record.status,
        createdAt: record.createdAt,
        canceledAt: record.canceledAt,
        deliveredAt: record.deliveredAt,
        quotation: record.quotation,
      };
    }

    if (entity === 'receivables' || entity === 'payables') {
      const parent =
        entity === 'receivables' ? record.receivable : record.payable;
      return {
        id: record.id,
        titleId: parent?.id,
        installmentNumber: record.installmentNumber,
        status: this.getFinancialInstallmentStatus(record),
        dueDate: record.dueDate,
        paidDate: record.paidDate,
        provisionDate: record.provisionDate,
        amount: this.getFinancialValue(record),
        description: parent?.description,
        reference: parent?.reference,
        party:
          entity === 'receivables'
            ? parent?.client || null
            : parent?.supplier || null,
      };
    }

    if (this.catalog[entity].domain === 'fiscal') {
      return {
        id: record.id,
        numero: record.numero,
        serie: record.serie,
        status: record.status,
        ambiente: record.ambiente === 1 ? 'producao' : 'homologacao',
        createdAt: record.createdAt,
        dataEmissao: record.dataEmissao,
        dataAutorizacao: record.dataAutorizacao,
        dataCompetencia: record.dataCompetencia,
        dataCancelamento: record.dataCancelamento,
        motivoRejeicao: record.motivoRejeicao,
        motivoCancelamento: record.motivoCancelamento,
        orderId: record.orderId,
        quotationId: record.quotationId,
        contingencia: record.contingencia,
      };
    }

    return record;
  }

  private getFinancialInstallmentStatus(record: any): PaymentStatus {
    if (record.status === PaymentStatus.CANCELED) return PaymentStatus.CANCELED;
    if (record.status === PaymentStatus.PAID || record.paidDate) {
      return PaymentStatus.PAID;
    }
    if (record.status === PaymentStatus.PROVISIONED || record.provisionDate) {
      return PaymentStatus.PROVISIONED;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (record.dueDate < today) return PaymentStatus.OVERDUE;
    return PaymentStatus.PENDING;
  }

  private getFinancialValue(record: any) {
    return Number(record.paidAmount ?? record.amount ?? 0);
  }

  private normalizeLimit(value: unknown) {
    const parsed = Number(value || 5);
    if (!Number.isInteger(parsed) || parsed < 1) return 5;
    return Math.min(parsed, 10);
  }

  private parseProjectDate(value: string, endOfDay: boolean) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('Data operacional invalida.');
    }

    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    const parsed = new Date(`${value}T${time}${PROJECT_TIMEZONE_OFFSET}`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Data operacional invalida.');
    }
    return parsed;
  }

  private normalizeEntity(value: unknown): OperationalEntity {
    const normalized = String(value || '').trim() as OperationalEntity;
    if (!this.catalog[normalized]) {
      throw new Error('Entidade operacional nao permitida.');
    }
    return normalized;
  }

  private normalizeMetric(
    value: unknown,
    entity: OperationalEntity,
  ): OperationalMetric {
    const normalized = String(value || '').trim() as OperationalMetric;
    if (!['count', 'sum'].includes(normalized)) {
      throw new Error('Metrica operacional nao permitida.');
    }
    if (normalized === 'sum' && this.catalog[entity].domain !== 'financial') {
      throw new Error('Soma permitida apenas para entidades financeiras.');
    }
    return normalized;
  }

  private normalizeStatus(value: unknown, allowedValues: string[]) {
    if (!value) return undefined;
    const normalized = String(value).trim().toUpperCase();
    if (!allowedValues.includes(normalized)) {
      throw new Error('Status operacional nao permitido.');
    }
    return normalized;
  }

  private normalizeDateField(
    value: unknown,
    allowedValues: string[],
    defaultValue = 'createdAt',
  ) {
    if (!value) return defaultValue;
    const normalized = String(value).trim();
    if (!allowedValues.includes(normalized)) {
      throw new Error('Campo de data operacional nao permitido.');
    }
    return normalized;
  }
}

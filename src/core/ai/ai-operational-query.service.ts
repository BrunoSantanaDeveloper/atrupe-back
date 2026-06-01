import { Injectable } from '@nestjs/common';
import { OrderStatus, QuotationStatus } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { AiRequestUser } from './ai.types';

type OperationalEntity = 'orders' | 'quotations';
type OperationalMetric = 'count';
type ToolArgs = Record<string, unknown>;
const PROJECT_TIMEZONE_OFFSET = '-03:00';

interface OperationalCatalogEntry {
  permission: string;
  statuses: string[];
  dateFields: string[];
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
        statuses: Object.values(OrderStatus),
        dateFields: ['createdAt', 'updatedAt', 'canceledAt', 'deliveredAt'],
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
        statuses: Object.values(QuotationStatus),
        dateFields: ['createdAt', 'updatedAt', 'dueDate'],
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
          description: 'Entidade operacional consultada.',
        },
        metric: {
          type: 'string',
          enum: ['count'],
          description: 'Metrica agregada solicitada.',
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
              ],
            },
            sellerId: { type: 'string' },
            clientId: { type: 'string' },
            serieId: { type: 'string' },
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
            serieId: { type: 'string' },
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
          description: 'ID do registro operacional retornado por uma busca.',
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
    const metric = this.normalizeMetric(args.metric);
    const filters = this.cleanFilters(args.filters);
    const catalogEntry = this.catalog[entity];

    await this.ensurePermission(user, catalogEntry.permission);
    await this.enforceSellerScope(user, filters);

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
    const status = this.normalizeStatus(filters.status, catalogEntry.statuses);
    const dateField = this.normalizeDateField(
      filters.dateField,
      catalogEntry.dateFields,
    );
    const limit = this.normalizeLimit(args.limit);

    await this.ensurePermission(user, catalogEntry.permission);
    await this.enforceSellerScope(user, filters);

    const where = this.buildWhere(entity, filters, status, dateField);
    const records =
      entity === 'orders'
        ? await this.prisma.order.findMany({
            where,
            select: this.orderSelect(),
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : await this.prisma.quotation.findMany({
            where,
            select: this.quotationSelect(),
            orderBy: { createdAt: 'desc' },
            take: limit,
          });

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
    await this.ensurePermission(user, catalogEntry.permission);
    await this.enforceSellerScope(user, filters);

    const where = {
      ...this.buildWhere(entity, filters, undefined, 'createdAt'),
      id,
    };
    const record =
      entity === 'orders'
        ? await this.prisma.order.findFirst({
            where,
            select: this.orderSelect(),
          })
        : await this.prisma.quotation.findFirst({
            where,
            select: this.quotationSelect(),
          });

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
    );
    const where = this.buildWhere(entity, filters, requestedStatus, dateField);
    const grouped =
      entity === 'orders'
        ? await this.prisma.order.groupBy({
            by: ['status'],
            where,
            _count: true,
          })
        : await this.prisma.quotation.groupBy({
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

  private buildWhere(
    entity: OperationalEntity,
    filters: ToolArgs,
    status: string | undefined,
    dateField: string,
  ) {
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
      'serieId',
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

  private async enforceSellerScope(user: AiRequestUser, filters: ToolArgs) {
    const canSeeOtherSellers = await this.abacService.hasPermission(
      user,
      'view',
      'sale:other_quotation',
    );
    if (!canSeeOtherSellers && !user.isAdmin && user.employeeId) {
      filters.sellerId = user.employeeId;
    }
    filters.companyId = user.companyId;
  }

  private applyDateRange(where: any, dateField: string, filters: ToolArgs) {
    const range: Record<string, Date> = {};
    if (filters.startDate)
      range.gte = this.parseProjectDate(String(filters.startDate), false);
    if (filters.endDate)
      range.lte = this.parseProjectDate(String(filters.endDate), true);
    if (Object.keys(range).length) where[dateField] = range;
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

    return record;
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

  private normalizeMetric(value: unknown): OperationalMetric {
    const normalized = String(value || '').trim() as OperationalMetric;
    if (normalized !== 'count') {
      throw new Error('Metrica operacional nao permitida.');
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

  private normalizeDateField(value: unknown, allowedValues: string[]) {
    if (!value) return 'createdAt';
    const normalized = String(value).trim();
    if (!allowedValues.includes(normalized)) {
      throw new Error('Campo de data operacional nao permitido.');
    }
    return normalized;
  }
}

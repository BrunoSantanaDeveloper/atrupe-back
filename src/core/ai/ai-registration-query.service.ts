import { Injectable } from '@nestjs/common';
import { ClientStatus, ProductStatus } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { AiRequestUser } from './ai.types';

type RegistrationEntity = 'clients' | 'suppliers' | 'products';
type RegistrationMetric = 'count';
type ToolArgs = Record<string, unknown>;
const PROJECT_TIMEZONE_OFFSET = '-03:00';

interface RegistrationCatalogEntry {
  /** Basta uma: como nas rotas, a ação vem junto do recurso. */
  permissions: { action: string; resource: string }[];
  statuses: string[];
  dateFields: string[];
  defaultDateField: string;
  labels: Record<string, string>;
}

export class AiRegistrationQueryDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

@Injectable()
export class AiRegistrationQueryService {
  private readonly catalog: Record<
    RegistrationEntity,
    RegistrationCatalogEntry
  > = {
    clients: {
      permissions: [{ action: 'view', resource: 'register:client' }],
      statuses: Object.values(ClientStatus),
      dateFields: ['createdAt', 'updatedAt'],
      defaultDateField: 'createdAt',
      labels: {
        PROSPECT: 'Prospectos',
        ACTIVE: 'Ativos',
        INACTIVE: 'Inativos',
      },
    },
    suppliers: {
      permissions: [{ action: 'view', resource: 'register:supplier' }],
      statuses: Object.values(ClientStatus),
      dateFields: ['createdAt', 'updatedAt'],
      defaultDateField: 'createdAt',
      labels: {
        PROSPECT: 'Prospectos',
        ACTIVE: 'Ativos',
        INACTIVE: 'Inativos',
      },
    },
    // Quem vê o cadastro de produtos ou quem orça: o vendedor precisa achar o
    // produto para montar o orçamento (28/10/2026; antes, qualquer perfil)
    products: {
      permissions: [
        { action: 'view', resource: 'product_settings:products' },
        { action: 'create', resource: 'sale:quotation' },
      ],
      statuses: Object.values(ProductStatus),
      dateFields: [],
      defaultDateField: '',
      labels: {
        ACTIVE: 'Ativos',
        INACTIVE: 'Inativos',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
  ) {}

  getMetricsToolSchema() {
    return {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          enum: Object.keys(this.catalog),
          description: 'Cadastro consultado.',
        },
        metric: {
          type: 'string',
          enum: ['count'],
          description: 'Metrica cadastral solicitada.',
        },
        filters: this.getFiltersSchema(),
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
        filters: this.getFiltersSchema(),
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
          description: 'ID do cadastro retornado por uma busca.',
        },
      },
      required: ['entity', 'id'],
    };
  }

  async query(args: ToolArgs, user: AiRequestUser) {
    const entity = this.normalizeEntity(args.entity);
    this.normalizeMetric(args.metric);
    const filters = this.cleanFilters(args.filters);
    filters.status = this.normalizeStatus(entity, filters.status);
    await this.prepareScope(entity, filters, user);

    const records = await this.findMany(entity, filters);
    const formatted = this.filterByReadiness(
      records.map((record) => this.formatRecord(entity, record)),
      filters.fiscalReadiness,
    );
    const entry = this.catalog[entity];
    const counts = entry.statuses
      .filter((status) => !filters.status || status === filters.status)
      .map((status) => ({
        status,
        label: entry.labels[status] || status,
        count: formatted.filter((record) => record.status === status).length,
      }));

    return {
      entity,
      metric: 'count',
      filters: {
        status: filters.status || null,
        fiscalReadiness: filters.fiscalReadiness || null,
      },
      counts,
      readiness: {
        ready: formatted.filter((record) => record.fiscalReadiness === 'READY')
          .length,
        incomplete: formatted.filter(
          (record) => record.fiscalReadiness === 'INCOMPLETE',
        ).length,
      },
      total: formatted.length,
    };
  }

  async search(args: ToolArgs, user: AiRequestUser) {
    const entity = this.normalizeEntity(args.entity);
    const filters = this.cleanFilters(args.filters);
    filters.status = this.normalizeStatus(entity, filters.status);
    await this.prepareScope(entity, filters, user);

    const limit = this.normalizeLimit(args.limit);
    const records = await this.findMany(
      entity,
      filters,
      filters.fiscalReadiness ? Math.min(limit * 5, 50) : limit,
    );
    const formatted = this.filterByReadiness(
      records.map((record) => this.formatRecord(entity, record)),
      filters.fiscalReadiness,
    ).slice(0, limit);

    return {
      entity,
      filters: {
        search: filters.search || null,
        status: filters.status || null,
        fiscalReadiness: filters.fiscalReadiness || null,
      },
      limit,
      records: formatted,
    };
  }

  async details(args: ToolArgs, user: AiRequestUser) {
    const entity = this.normalizeEntity(args.entity);
    const id = String(args.id || '').trim();
    if (!id) throw new Error('ID cadastral obrigatorio.');

    const filters: ToolArgs = {};
    await this.prepareScope(entity, filters, user);
    const record = await this.registrationModel(entity).findFirst({
      where: {
        ...this.buildWhere(entity, filters),
        id,
      },
      select: this.registrationSelect(entity),
    });

    return {
      entity,
      record: record ? this.formatRecord(entity, record) : null,
    };
  }

  private getFiltersSchema() {
    return {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string' },
        fiscalReadiness: {
          type: 'string',
          enum: ['READY', 'INCOMPLETE'],
          description:
            'Use INCOMPLETE para localizar cadastros com pendencias fiscais.',
        },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        dateField: {
          type: 'string',
          enum: ['createdAt', 'updatedAt'],
        },
      },
    };
  }

  private async findMany(
    entity: RegistrationEntity,
    filters: ToolArgs,
    take?: number,
  ) {
    return this.registrationModel(entity).findMany({
      where: this.buildWhere(entity, filters),
      select: this.registrationSelect(entity),
      orderBy: entity === 'products' ? { name: 'asc' } : { createdAt: 'desc' },
      ...(take ? { take } : {}),
    });
  }

  private buildWhere(entity: RegistrationEntity, filters: ToolArgs) {
    const where: any = {
      companyId: String(filters.companyId),
    };

    if (entity === 'products') {
      where.isActive = filters.status
        ? filters.status === ProductStatus.ACTIVE
        : true;
    } else if (filters.status) {
      where.status = filters.status;
    }

    this.applySearch(where, entity, filters.search);
    this.applyDateRange(where, entity, filters);
    return where;
  }

  private applySearch(where: any, entity: RegistrationEntity, value: unknown) {
    const search = String(value || '').trim();
    if (!search) return;

    where.OR =
      entity === 'products'
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            {
              technicalDescription: {
                contains: search,
                mode: 'insensitive',
              },
            },
          ]
        : [
            { name: { contains: search, mode: 'insensitive' } },
            { corporateName: { contains: search, mode: 'insensitive' } },
            { tradeName: { contains: search, mode: 'insensitive' } },
          ];
  }

  private applyDateRange(
    where: any,
    entity: RegistrationEntity,
    filters: ToolArgs,
  ) {
    if (entity === 'products') return;

    const dateField = this.normalizeDateField(entity, filters.dateField);
    const range: Record<string, Date> = {};
    if (filters.startDate) {
      range.gte = this.parseProjectDate(String(filters.startDate), false);
    }
    if (filters.endDate) {
      range.lte = this.parseProjectDate(String(filters.endDate), true);
    }
    if (Object.keys(range).length) where[dateField] = range;
  }

  private registrationSelect(entity: RegistrationEntity) {
    if (entity === 'products') {
      return {
        id: true,
        name: true,
        code: true,
        isActive: true,
        isService: true,
        fiscalData: {
          select: {
            ncm: true,
            cfopInState: true,
            cfopOutState: true,
            codigoServico: true,
          },
        },
      };
    }

    return {
      id: true,
      name: true,
      status: true,
      type: true,
      cpf: true,
      cnpj: true,
      stateRegistration: true,
      indicadorIE: true,
      address: {
        where: { ownerType: entity === 'clients' ? 'CLIENT' : 'SUPPLIER' },
        take: 1,
        select: {
          street: true,
          number: true,
          neighborhood: true,
          city: true,
          state: true,
          zipcode: true,
        },
      },
    };
  }

  private formatRecord(entity: RegistrationEntity, record: any) {
    const assessment =
      entity === 'products'
        ? this.assessProduct(record)
        : this.assessParty(record);

    if (entity === 'products') {
      return {
        id: record.id,
        name: record.name,
        code: record.code,
        status: record.isActive ? ProductStatus.ACTIVE : ProductStatus.INACTIVE,
        isService: record.isService,
        ...assessment,
      };
    }

    return {
      id: record.id,
      name: record.name,
      status: record.status,
      type: record.type,
      hasDocument: !!(record.cpf || record.cnpj),
      hasAddress: !!record.address?.[0],
      ...assessment,
    };
  }

  private assessParty(record: any) {
    const missingFields: string[] = [];
    if (!record.cpf && !record.cnpj) missingFields.push('CPF ou CNPJ');
    if (!record.name) missingFields.push('Nome');

    const address = record.address?.[0];
    if (!address) {
      missingFields.push('Endereco completo');
    } else {
      if (!address.street) missingFields.push('Logradouro');
      if (!address.number) missingFields.push('Numero');
      if (!address.neighborhood) missingFields.push('Bairro');
      if (!address.city) missingFields.push('Cidade');
      if (!address.state) missingFields.push('UF');
      if (!address.zipcode) missingFields.push('CEP');
    }
    if (record.indicadorIE === 1 && !record.stateRegistration) {
      missingFields.push('Inscricao Estadual (IE)');
    }

    return {
      fiscalReadiness: missingFields.length ? 'INCOMPLETE' : 'READY',
      missingFields,
    };
  }

  private assessProduct(record: any) {
    const missingFields: string[] = [];
    const fiscalData = record.fiscalData;
    if (!fiscalData) {
      missingFields.push('Dados fiscais');
    } else if (record.isService) {
      if (!fiscalData.codigoServico) missingFields.push('Codigo do servico');
    } else {
      if (!this.isValidConfiguredNcm(fiscalData.ncm)) missingFields.push('NCM');
      if (!fiscalData.cfopInState) missingFields.push('CFOP dentro do estado');
      if (!fiscalData.cfopOutState) missingFields.push('CFOP fora do estado');
    }

    return {
      fiscalReadiness: missingFields.length ? 'INCOMPLETE' : 'READY',
      missingFields,
    };
  }

  private isValidConfiguredNcm(value: unknown) {
    const ncm = String(value || '').replace(/\D/g, '');
    return ncm.length === 8 && ncm !== '00000000';
  }

  private filterByReadiness(records: any[], value: unknown) {
    if (!value) return records;
    return records.filter((record) => record.fiscalReadiness === value);
  }

  private async prepareScope(
    entity: RegistrationEntity,
    filters: ToolArgs,
    user: AiRequestUser,
  ) {
    if (!user.companyId) {
      throw new AiRegistrationQueryDeniedError('Usuario sem empresa ativa.');
    }

    const allowed = await this.abacService.hasAnyPermission(
      user,
      this.catalog[entity].permissions,
    );
    if (!allowed) {
      throw new AiRegistrationQueryDeniedError(
        'Seu perfil nao possui permissao para realizar essa consulta.',
      );
    }
    filters.companyId = user.companyId;
  }

  private cleanFilters(value: unknown): ToolArgs {
    const filters =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as ToolArgs)
        : {};
    const allowedKeys = [
      'search',
      'status',
      'fiscalReadiness',
      'startDate',
      'endDate',
      'dateField',
    ];
    const clean = Object.fromEntries(
      Object.entries(filters).filter(
        ([key, item]) =>
          allowedKeys.includes(key) &&
          item !== undefined &&
          item !== null &&
          item !== '',
      ),
    );

    if (clean.status) clean.status = String(clean.status).trim().toUpperCase();
    if (clean.fiscalReadiness) {
      clean.fiscalReadiness = String(clean.fiscalReadiness)
        .trim()
        .toUpperCase();
      if (!['READY', 'INCOMPLETE'].includes(String(clean.fiscalReadiness))) {
        throw new Error('Prontidao fiscal nao permitida.');
      }
    }
    return clean;
  }

  private registrationModel(entity: RegistrationEntity): any {
    if (entity === 'clients') return this.prisma.client;
    if (entity === 'suppliers') return this.prisma.supplier;
    if (entity === 'products') return this.prisma.product;
    throw new Error('Entidade cadastral nao permitida.');
  }

  private normalizeEntity(value: unknown): RegistrationEntity {
    const entity = String(value || '').trim() as RegistrationEntity;
    if (!this.catalog[entity])
      throw new Error('Entidade cadastral nao permitida.');
    return entity;
  }

  private normalizeMetric(value: unknown): RegistrationMetric {
    const metric = String(value || '').trim() as RegistrationMetric;
    if (metric !== 'count') throw new Error('Metrica cadastral nao permitida.');
    return metric;
  }

  private normalizeStatus(entity: RegistrationEntity, value: unknown) {
    if (!value) return undefined;
    const status = String(value).trim().toUpperCase();
    if (!this.catalog[entity].statuses.includes(status)) {
      throw new Error('Status cadastral nao permitido.');
    }
    return status;
  }

  private normalizeDateField(entity: RegistrationEntity, value: unknown) {
    const entry = this.catalog[entity];
    if (!value) return entry.defaultDateField;
    const dateField = String(value).trim();
    if (!entry.dateFields.includes(dateField)) {
      throw new Error('Campo de data cadastral nao permitido.');
    }
    return dateField;
  }

  private normalizeLimit(value: unknown) {
    const parsed = Number(value || 5);
    if (!Number.isInteger(parsed) || parsed < 1) return 5;
    return Math.min(parsed, 10);
  }

  private parseProjectDate(value: string, endOfDay: boolean) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('Data cadastral invalida.');
    }
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    const parsed = new Date(`${value}T${time}${PROJECT_TIMEZONE_OFFSET}`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Data cadastral invalida.');
    }
    return parsed;
  }
}

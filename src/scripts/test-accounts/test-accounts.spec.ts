import { ForbiddenException } from '@nestjs/common';
import { PLAN_FIXTURES } from './fixtures';
import {
  fixtureKey,
  PLAN_LABELS,
  TEST_PLAN_TYPES,
  testAccountEmail,
  TestFamily,
  TestPlanType,
} from './options';
import {
  ensureTestAccount,
  formatReport,
  TestAccountDeps,
  TestAccountTarget,
} from './test-accounts';

/**
 * Banco de mentira, em memória, com o pedaço do Prisma que o script usa e os
 * serviços do cadastro reduzidos ao que gravam. Serve para provar o que
 * importa no script sem banco: o que a primeira execução cria, que a segunda
 * não grava nada e o que cada modo reafirma.
 */

const DOMAIN = 'teste.example';
const PASSWORD = 'senha-das-contas-1';
const NOW = new Date('2026-10-11T12:00:00.000Z');
const DAY_MS = 86_400_000;

type Row = Record<string, any>;

const hash = (password: string) => `hash:${password}`;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Row[]).some((item) => matches(row, item));
    }
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (typeof condition === 'object' && !(condition instanceof Date)) {
      if ('equals' in condition) {
        return condition.mode === 'insensitive'
          ? String(value ?? '').toLowerCase() ===
              String(condition.equals).toLowerCase()
          : value === condition.equals;
      }
      if ('startsWith' in condition) {
        return (
          typeof value === 'string' && value.startsWith(condition.startsWith)
        );
      }
      throw new Error(`filtro sem suporte no banco de mentira: ${key}`);
    }
    return value === condition;
  });
}

function sortRows(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) =>
    a[field] < b[field] ? -sign : a[field] > b[field] ? sign : 0,
  );
}

class FakeDb {
  tables: Record<string, Row[]> = {
    user: [],
    company: [],
    plan: [],
    subscription: [],
    customer: [],
    companySector: [],
    role: [],
    sellerProfile: [],
    employee: [],
    client: [],
    supplier: [],
    quotation: [],
    saleSeries: [],
  };
  /** Cada gravação (create/update/delete), na ordem. */
  writes: string[] = [];
  private seq = 0;

  nextId(prefix: string) {
    this.seq++;
    return `${prefix}-${this.seq}`;
  }

  /** Linha que já existia antes da execução: não conta como gravação. */
  seed(table: string, data: Row): Row {
    this.seq++;
    const row = {
      id: `${table}-${this.seq}`,
      createdAt: new Date(NOW.getTime() - DAY_MS + this.seq * 1000),
      ...data,
    };
    this.tables[table].push(row);
    return row;
  }

  insert(table: string, data: Row): Row {
    const row = this.seed(table, data);
    this.writes.push(`${table}.create`);
    return row;
  }

  one(table: string, where: Row): Row {
    const row = this.tables[table].find((item) => matches(item, where));
    if (!row)
      throw new Error(`${table} não encontrado: ${JSON.stringify(where)}`);
    return row;
  }
}

function fakePrisma(db: FakeDb) {
  const model = (table: string, view = (row: Row): Row => ({ ...row })) => ({
    findFirst: jest.fn(async (args: Row = {}) => {
      const [row] = sortRows(
        db.tables[table].filter((item) => matches(item, args.where)),
        args.orderBy,
      );
      return row ? view(row) : null;
    }),
    findUnique: jest.fn(async (args: Row) => {
      const row = db.tables[table].find((item) => matches(item, args.where));
      return row ? view(row) : null;
    }),
    findMany: jest.fn(async (args: Row = {}) =>
      sortRows(
        db.tables[table].filter((item) => matches(item, args.where)),
        args.orderBy,
      ).map(view),
    ),
    create: jest.fn(async ({ data }: Row) => view(db.insert(table, data))),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = db.one(table, { id: where.id });
      Object.assign(row, data);
      db.writes.push(`${table}.update`);
      return view(row);
    }),
    delete: jest.fn(async ({ where }: Row) => {
      const index = db.tables[table].findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error(`${table} ${where.id} não existe`);
      db.tables[table].splice(index, 1);
      db.writes.push(`${table}.delete`);
      return {};
    }),
  });

  return {
    user: model('user', (row) => ({
      ...row,
      employee: db.tables.employee
        .filter((employee) => employee.userId === row.id)
        .map((employee) => ({ ...employee })),
    })),
    company: model('company'),
    plan: model('plan'),
    subscription: model('subscription'),
    customer: model('customer'),
    companySector: model('companySector'),
    role: model('role'),
    sellerProfile: model('sellerProfile'),
    employee: model('employee'),
    client: model('client'),
    supplier: model('supplier'),
    quotation: model('quotation'),
    saleSeries: model('saleSeries'),
  };
}

function fakeServices(db: FakeDb) {
  return {
    companyService: {
      // Dos itens padrão do cadastro, só o que o script usa: os setores, o
      // cargo Vendedor e a série V1.
      createMainCompany: jest.fn(async (email: string, dto: any) => {
        const company = db.insert('company', {
          name: dto.general.name,
          email,
          ownerUserId: null,
          principalCompanyId: null,
          isActive: true,
          blockLevel: 'NONE',
          blockedAt: null,
          blockReason: null,
        });
        for (const name of ['Administração', 'Comercial', 'Produção']) {
          db.insert('companySector', { companyId: company.id, name });
        }
        db.insert('role', {
          companyId: company.id,
          name: 'Vendedor',
          permissions: [],
          isActive: true,
          isAdmin: false,
          sectorId: db.one('companySector', {
            companyId: company.id,
            name: 'Comercial',
          }).id,
        });
        db.insert('saleSeries', { companyId: company.id, code: 'V1' });
        return { id: company.id };
      }),
      createFirstAccess: jest.fn(async (email: string, companyId: string) => {
        const user = db.one('user', { email });
        db.one('company', { id: companyId }).ownerUserId = user.id;
        const sector = db.one('companySector', {
          companyId,
          name: 'Administração',
        });
        const role = db.insert('role', {
          companyId,
          name: 'Admin',
          permissions: [],
          isActive: true,
          isAdmin: true,
          sectorId: sector.id,
        });
        db.insert('employee', {
          companyId,
          userId: user.id,
          roleId: role.id,
          sectorId: sector.id,
          isActive: true,
          sellerProfileId: null,
          legacyId: null,
        });
        return 'success';
      }),
    },
    employeeService: {
      create: jest.fn(async (dto: any) =>
        db.insert('employee', {
          companyId: dto.companyId,
          roleId: dto.roleId,
          sectorId: dto.sectorId,
          name: dto.name,
          isActive: true,
          userId: null,
          sellerProfileId: null,
          legacyId: null,
        }),
      ),
    },
    userRegistration: {
      createUserForEmployee: jest.fn(async (dto: any) => {
        const user = db.insert('user', {
          email: dto.email,
          name: dto.name,
          password: hash(dto.password),
          isActive: true,
        });
        db.one('employee', { id: dto.employeeId }).userId = user.id;
        return user;
      }),
    },
    planControl: {
      // A conta do PlanControlService: colaboradores ativos com usuário
      // ativo, contra 3 + usuários adicionais da assinatura ativa.
      enforceUserLimit: jest.fn(
        async (companyId: string, excludeUserId?: string) => {
          const subscription = db.tables.subscription.find(
            (item) => item.companyId === companyId && item.status === 'ACTIVE',
          );
          if (!subscription) {
            throw new ForbiddenException({
              code: 'PLAN_LIMIT_REACHED',
              message: 'A empresa não tem uma assinatura ativa.',
            });
          }
          const limit = 3 + subscription.additionalUsers;
          const used = db.tables.employee.filter(
            (employee) =>
              employee.companyId === companyId &&
              employee.isActive &&
              employee.userId &&
              employee.userId !== excludeUserId &&
              db.tables.user.find((user) => user.id === employee.userId)
                ?.isActive,
          ).length;
          if (used + 1 > limit) {
            throw new ForbiddenException({
              code: 'PLAN_LIMIT_REACHED',
              message: `Limite do plano atingido (máximo ${limit}).`,
            });
          }
        },
      ),
    },
    // Os serviços de cadastro devolvem o formato da tela, sem o id.
    clientService: {
      create: jest.fn(async (dto: any) => {
        db.insert('client', {
          companyId: dto.companyId,
          name: dto.general.name,
          status: 'PROSPECT',
          legacyId: null,
        });
        return { general: { name: dto.general.name } };
      }),
    },
    supplierService: {
      create: jest.fn(async (dto: any) => {
        db.insert('supplier', {
          companyId: dto.companyId,
          name: dto.general.name,
          status: 'ACTIVE',
          legacyId: null,
        });
        return { general: { name: dto.general.name } };
      }),
    },
    quotationService: {
      create: jest.fn(async (dto: any) =>
        db.insert('quotation', {
          companyId: dto.companyId,
          sellerId: dto.sellerId,
          clientId: dto.clientId,
          seriesId: dto.seriesId,
          description: dto.description,
          isActive: true,
          legacyId: null,
        }),
      ),
    },
  };
}

function setup() {
  const db = new FakeDb();
  TEST_PLAN_TYPES.forEach((planType, order) =>
    db.seed('plan', {
      id: `plan-${planType}`,
      planType,
      companyId: null,
      name: PLAN_LABELS[planType],
      basePrice: order * 10000,
      order,
    }),
  );
  const prisma = fakePrisma(db);
  const services = fakeServices(db);
  const deps = {
    prisma,
    ...services,
    hashPassword: async (password: string) => hash(password),
    verifyPassword: async (stored: string, password: string) =>
      stored === hash(password),
    now: () => NOW,
    newId: () => db.nextId('uuid'),
  } as unknown as TestAccountDeps;
  return { db, deps, services };
}

function target(
  planType: TestPlanType,
  overrides: Partial<TestAccountTarget> = {},
): TestAccountTarget {
  return {
    family: 'e2e',
    fixture: PLAN_FIXTURES[planType],
    emailDomain: DOMAIN,
    password: PASSWORD,
    mode: 'garantir',
    dryRun: false,
    ...overrides,
  };
}

const email = (
  cargo: 'admin' | 'vendedor' | 'producao' | 'caixa',
  planType: TestPlanType,
  family: TestFamily = 'e2e',
) => testAccountEmail(cargo, family, planType, DOMAIN);

describe('ensureTestAccount', () => {
  it('cria a conta LITE inteira na primeira execução', async () => {
    const { db, deps, services } = setup();

    const report = await ensureTestAccount(deps, target('LITE'));

    expect(report.errors).toEqual([]);
    expect(report.outcome).toBe('criada');
    expect(services.companyService.createMainCompany).toHaveBeenCalledWith(
      email('admin', 'LITE'),
      expect.objectContaining({
        general: expect.objectContaining({
          name: '[TESTE] Comunicação Visual Lite (e2e)',
          cnpj: '',
        }),
      }),
    );
    const company = db.one('company', {});
    expect(company.ownerUserId).toBe(
      db.one('user', { email: email('admin', 'LITE') }).id,
    );

    // Assinatura manual_ no plano LITE, com o Caixa como usuário adicional.
    expect(db.tables.subscription).toEqual([
      expect.objectContaining({
        companyId: company.id,
        planId: 'plan-LITE',
        status: 'ACTIVE',
        billingMode: 'MANUAL',
        additionalUsers: 1,
        asaasSubscriptionId: expect.stringMatching(/^manual_/),
      }),
    ]);
    expect(db.tables.subscription[0].nextDueDate.getTime()).toBe(
      NOW.getTime() + 365 * DAY_MS,
    );
    expect(db.tables.customer).toEqual([
      expect.objectContaining({
        companyId: company.id,
        asaasCustomerId: expect.stringMatching(/^manual_/),
      }),
    ]);

    // Um usuário por cargo, com a senha do ambiente.
    expect(db.tables.user.map((user) => user.email).sort()).toEqual(
      [
        email('admin', 'LITE'),
        email('caixa', 'LITE'),
        email('producao', 'LITE'),
        email('vendedor', 'LITE'),
      ].sort(),
    );
    expect(
      db.tables.user.every((user) => user.password === hash(PASSWORD)),
    ).toBe(true);
    expect(report.users).toEqual({
      admin: 'ok',
      vendedor: 'criado',
      producao: 'criado',
      caixa: 'criado',
    });

    // Cargos com as permissões da fixture (o Vendedor padrão é reaproveitado).
    for (const role of PLAN_FIXTURES.LITE.roles) {
      expect(
        db.one('role', { companyId: company.id, name: role.roleName }),
      ).toMatchObject({
        permissions: role.permissions,
        isAdmin: false,
      });
    }
    expect(
      db.tables.role.filter((role) => role.name === 'Vendedor'),
    ).toHaveLength(1);
    const vendedor = db.one('employee', { legacyId: 'e2e:usuario:vendedor' });
    expect(vendedor.sellerProfileId).toBe(
      db.one('sellerProfile', { name: 'Vendedor' }).id,
    );

    // Dados v1 marcados com o legacyId da família.
    expect(db.tables.client.map((client) => client.legacyId).sort()).toEqual(
      PLAN_FIXTURES.LITE.clients.map((client) =>
        fixtureKey('e2e', 'cliente', client.ref),
      ),
    );
    expect(
      db.tables.supplier.map((supplier) => supplier.legacyId).sort(),
    ).toEqual(['e2e:fornecedor:01', 'e2e:fornecedor:02', 'e2e:fornecedor:03']);
    expect(db.tables.quotation).toHaveLength(3);
    for (const quotation of db.tables.quotation) {
      expect(quotation).toMatchObject({
        sellerId: vendedor.id,
        seriesId: db.one('saleSeries', { code: 'V1' }).id,
        legacyId: expect.stringMatching(/^e2e:orcamento:0[1-3]$/),
      });
    }
    expect(db.one('quotation', { legacyId: 'e2e:orcamento:01' }).clientId).toBe(
      db.one('client', { legacyId: 'e2e:cliente:05' }).id,
    );
    expect(report.data).toEqual({
      clientes: { existentes: 0, criados: 8, aposentados: 0 },
      fornecedores: { existentes: 0, criados: 3, aposentados: 0 },
      orcamentos: { existentes: 0, criados: 3, aposentados: 0 },
    });
  });

  it('a segunda execução não grava nada', async () => {
    const { db, deps, services } = setup();
    await ensureTestAccount(deps, target('LITE'));
    const writes = db.writes.length;

    const second = await ensureTestAccount(deps, target('LITE'));

    expect(second.errors).toEqual([]);
    expect(second.outcome).toBe('conferida');
    expect(second.changes).toEqual([]);
    expect(db.writes).toHaveLength(writes);
    expect(services.companyService.createMainCompany).toHaveBeenCalledTimes(1);
    expect(services.clientService.create).toHaveBeenCalledTimes(8);
    expect(services.quotationService.create).toHaveBeenCalledTimes(3);
    expect(second.users).toEqual({
      admin: 'ok',
      vendedor: 'ok',
      producao: 'ok',
      caixa: 'ok',
    });
    expect(second.data).toEqual({
      clientes: { existentes: 8, criados: 0, aposentados: 0 },
      fornecedores: { existentes: 3, criados: 0, aposentados: 0 },
      orcamentos: { existentes: 3, criados: 0, aposentados: 0 },
    });
  });

  it('as duas famílias do mesmo plano são contas separadas', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('START', { family: 'demo' }));
    await ensureTestAccount(deps, target('START', { family: 'e2e' }));

    expect(db.tables.company.map((company) => company.name).sort()).toEqual([
      '[TESTE] Comunicação Visual Start (demo)',
      '[TESTE] Comunicação Visual Start (e2e)',
    ]);
    expect(
      db.tables.client.filter((c) => c.legacyId.startsWith('demo:')),
    ).toHaveLength(8);
    expect(
      db.tables.client.filter((c) => c.legacyId.startsWith('e2e:')),
    ).toHaveLength(8);
  });

  it('START fica em 3 usuários, sem Caixa nem usuário adicional', async () => {
    const { db, deps } = setup();

    const report = await ensureTestAccount(deps, target('START'));

    expect(report.errors).toEqual([]);
    expect(Object.keys(report.users)).toEqual([
      'admin',
      'vendedor',
      'producao',
    ]);
    expect(db.tables.user).toHaveLength(3);
    expect(db.one('subscription', {})).toMatchObject({
      planId: 'plan-START',
      additionalUsers: 0,
    });
    expect(
      db.tables.role.find((role) => role.name === 'Caixa'),
    ).toBeUndefined();
  });

  it('reafirma assinatura, bloqueio, cargo e usuário alterados à mão', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('LITE'));

    const company = db.one('company', {});
    Object.assign(company, {
      blockLevel: 'FULL',
      blockedAt: NOW,
      blockReason: 'bloqueio manual',
    });
    const manual = db.one('subscription', {});
    Object.assign(manual, {
      planId: 'plan-START',
      additionalUsers: 0,
      nextDueDate: new Date(NOW.getTime() + 5 * DAY_MS),
    });
    const sandbox = db.seed('subscription', {
      companyId: company.id,
      status: 'ACTIVE',
      asaasSubscriptionId: 'sub_sandbox_1',
      billingMode: null,
      planId: 'plan-PRO',
      additionalUsers: 0,
      nextDueDate: NOW,
    });
    db.one('role', { name: 'Vendedor' }).permissions = ['sale:quotation:view'];
    const vendedor = db.one('user', { email: email('vendedor', 'LITE') });
    Object.assign(vendedor, { isActive: false, password: hash('outra-senha') });

    const report = await ensureTestAccount(deps, target('LITE'));

    expect(report.errors).toEqual([]);
    expect(company).toMatchObject({
      blockLevel: 'NONE',
      blockedAt: null,
      blockReason: null,
    });
    expect(manual).toMatchObject({
      planId: 'plan-LITE',
      additionalUsers: 1,
      status: 'ACTIVE',
    });
    expect(manual.nextDueDate.getTime()).toBe(NOW.getTime() + 365 * DAY_MS);
    expect(sandbox.status).toBe('INACTIVE');
    expect(db.one('role', { name: 'Vendedor' }).permissions).toEqual(
      PLAN_FIXTURES.LITE.roles[0].permissions,
    );
    expect(vendedor).toMatchObject({
      isActive: true,
      password: hash(PASSWORD),
    });
    expect(report.users.vendedor).toBe('reativado, senha regravada');
    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'desbloqueia a empresa (blockLevel FULL → NONE)',
        ),
        expect.stringContaining('plano → Lite'),
        expect.stringContaining(
          'inativa a outra assinatura ACTIVE da empresa (sub_sandbox_1)',
        ),
      ]),
    );
    // Os dados não são tocados.
    expect(db.tables.client).toHaveLength(8);
  });

  it('dry-run de conta nova só relata', async () => {
    const { db, deps, services } = setup();

    const report = await ensureTestAccount(
      deps,
      target('PRO', { dryRun: true }),
    );

    expect(report.outcome).toBe('nova');
    expect(db.writes).toEqual([]);
    expect(services.companyService.createMainCompany).not.toHaveBeenCalled();
    expect(report.users).toEqual({
      admin: 'a criar',
      vendedor: 'a criar',
      producao: 'a criar',
      caixa: 'a criar',
    });
    expect(report.data.clientes.criados).toBe(8);
    expect(report.changes.join('\n')).toContain('plano Pro');
  });

  it('dry-run de conta alterada diz o que faria, sem gravar', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('LITE'));
    const company = db.one('company', {});
    company.blockLevel = 'PARTIAL';
    db.one('user', { email: email('caixa', 'LITE') }).password = hash('outra');
    const writes = db.writes.length;

    const report = await ensureTestAccount(
      deps,
      target('LITE', { dryRun: true }),
    );

    expect(report.errors).toEqual([]);
    expect(db.writes).toHaveLength(writes);
    expect(company.blockLevel).toBe('PARTIAL');
    expect(report.users.caixa).toBe('senha regravada');
    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('desbloqueia a empresa'),
        expect.stringContaining(`regrava a senha de ${email('caixa', 'LITE')}`),
      ]),
    );
  });

  it('--refazer-dados aposenta os dados da fixture e cria de novo', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('LITE'));
    const before = db.one('client', { legacyId: 'e2e:cliente:01' });

    const report = await ensureTestAccount(
      deps,
      target('LITE', { mode: 'refazer-dados' }),
    );

    expect(report.errors).toEqual([]);
    expect(before).toMatchObject({
      legacyId: 'e2e:cliente:01~refeito-20261011-120000',
      status: 'INACTIVE',
    });
    const after = db.one('client', { legacyId: 'e2e:cliente:01' });
    expect(after.id).not.toBe(before.id);
    expect(db.tables.client).toHaveLength(16);
    expect(
      db.tables.quotation.filter((quotation) => !quotation.isActive),
    ).toHaveLength(3);
    expect(report.data).toEqual({
      clientes: { existentes: 0, criados: 8, aposentados: 8 },
      fornecedores: { existentes: 0, criados: 3, aposentados: 3 },
      orcamentos: { existentes: 0, criados: 3, aposentados: 3 },
    });
    // O orçamento novo aponta para o cliente novo.
    expect(db.one('quotation', { legacyId: 'e2e:orcamento:01' }).clientId).toBe(
      db.one('client', { legacyId: 'e2e:cliente:05' }).id,
    );
  });

  it('--refazer-dados em dry-run só conta', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('START'));
    const writes = db.writes.length;

    const report = await ensureTestAccount(
      deps,
      target('START', { mode: 'refazer-dados', dryRun: true }),
    );

    expect(db.writes).toHaveLength(writes);
    expect(report.data.clientes).toEqual({
      existentes: 0,
      criados: 8,
      aposentados: 8,
    });
  });

  it('--refazer-dados recusa a família demo sem tocar em nada', async () => {
    const { db, deps } = setup();

    const report = await ensureTestAccount(
      deps,
      target('START', { family: 'demo', mode: 'refazer-dados' }),
    );

    expect(report.outcome).toBe('falhou');
    expect(report.errors[0]).toMatch(/só vale para a família e2e/);
    expect(db.writes).toEqual([]);
  });

  it('não passa do limite do plano ao reativar um usuário', async () => {
    const { db, deps } = setup();
    await ensureTestAccount(deps, target('START'));
    const company = db.one('company', {});
    // Alguém inativou o usuário Produção e deu acesso a outra pessoa.
    const producao = db.one('user', { email: email('producao', 'START') });
    producao.isActive = false;
    const extra = db.seed('user', {
      email: 'outra.pessoa@teste.example',
      password: hash('x'),
      isActive: true,
    });
    db.seed('employee', {
      companyId: company.id,
      userId: extra.id,
      isActive: true,
    });

    const report = await ensureTestAccount(deps, target('START'));

    expect(report.users.producao).toBe('falhou');
    expect(report.errors).toEqual([
      expect.stringMatching(/^producao: PLAN_LIMIT_REACHED/),
    ]);
    expect(producao.isActive).toBe(false);
    expect(report.data.clientes.existentes).toBe(8);
  });

  it('retoma o colaborador que uma execução interrompida deixou sem usuário', async () => {
    const { db, deps, services } = setup();
    await ensureTestAccount(deps, target('LITE'));
    const employee = db.one('employee', { legacyId: 'e2e:usuario:producao' });
    db.tables.user = db.tables.user.filter(
      (user) => user.email !== email('producao', 'LITE'),
    );
    Object.assign(employee, {
      userId: null,
      isActive: false,
      roleId: 'cargo-errado',
    });
    const employeesBefore = db.tables.employee.length;

    const report = await ensureTestAccount(deps, target('LITE'));

    expect(report.errors).toEqual([]);
    expect(report.users.producao).toBe('criado, reativado, cargo reafirmado');
    expect(db.tables.employee).toHaveLength(employeesBefore);
    expect(services.employeeService.create).toHaveBeenCalledTimes(3);
    expect(employee).toMatchObject({
      isActive: true,
      roleId: db.one('role', { name: 'Produção' }).id,
      userId: db.one('user', { email: email('producao', 'LITE') }).id,
    });
  });

  it('não usa e-mail de cargo que já é de outra conta', async () => {
    const { db, deps } = setup();
    const other = db.seed('company', { name: 'Outra empresa' });
    const taken = db.seed('user', {
      email: email('vendedor', 'LITE'),
      password: hash('x'),
      isActive: true,
    });
    db.seed('employee', {
      companyId: other.id,
      userId: taken.id,
      isActive: true,
    });

    const report = await ensureTestAccount(deps, target('LITE'));

    expect(report.users.vendedor).toBe('falhou');
    expect(report.errors).toEqual([expect.stringMatching(/outra conta/)]);
    // Sem o vendedor, os orçamentos ficam com o administrador.
    const admin = db.one('user', { email: email('admin', 'LITE') });
    const adminEmployee = db.one('employee', { userId: admin.id });
    expect(db.tables.quotation.map((q) => q.sellerId)).toEqual([
      adminEmployee.id,
      adminEmployee.id,
      adminEmployee.id,
    ]);
    expect(taken.password).toBe(hash('x'));
  });

  it('administrador sem empresa: erro, nada gravado', async () => {
    const { db, deps } = setup();
    db.seed('user', {
      email: email('admin', 'START'),
      password: hash(PASSWORD),
      isActive: true,
    });

    const report = await ensureTestAccount(deps, target('START'));

    expect(report.outcome).toBe('falhou');
    expect(report.errors[0]).toMatch(/não é titular de nenhuma empresa/);
    expect(db.writes).toEqual([]);
  });

  it('falha no cadastro desfaz o usuário e a empresa, como no cadastro público', async () => {
    const { db, deps, services } = setup();
    services.companyService.createFirstAccess.mockRejectedValueOnce(
      new Error('setor não encontrado'),
    );

    const report = await ensureTestAccount(deps, target('START'));

    expect(report.outcome).toBe('falhou');
    expect(report.errors).toEqual(['setor não encontrado']);
    expect(db.tables.user).toEqual([]);
    expect(db.tables.company).toEqual([]);
  });
});

describe('formatReport', () => {
  it('monta a tabela, as mudanças e os erros', async () => {
    const { deps } = setup();
    const created = await ensureTestAccount(deps, target('START'));
    const text = formatReport([created], {
      mode: 'garantir',
      dryRun: false,
      fixturesVersion: 'v1 (teste)',
      emailDomain: DOMAIN,
    });

    expect(text).toContain('fixtures v1 (teste) — modo garantir');
    expect(text).toContain(
      `| e2e | START | ${email('admin', 'START')} | criada | manual_`,
    );
    expect(text).toContain('| 8 (8 novos) | 3 (3 novos) | 3 (3 novos) |');
    expect(text).toContain('e2e-start:');
    expect(text).not.toContain(PASSWORD);
  });
});

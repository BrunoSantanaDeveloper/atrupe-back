import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ClientService } from '../../core/client/client.service';
import type { CreateClientDto } from '../../core/client/dto/create-client.dto';
import type { CompanyService } from '../../core/company/company.service';
import type { CreateCompanyDto } from '../../core/company/dto/create-company.dto';
import type { EmployeeService } from '../../core/employee/employee.service';
import type { PlanControlService } from '../../core/plan/plan-control.service';
import type { QuotationService } from '../../core/sale/quotation/quotation.service';
import { billingModeOf } from '../../core/subscriptions/billing-mode';
import type { CreateSupplierDto } from '../../core/supplier/dto/create-supplier.dto';
import type { SupplierService } from '../../core/supplier/supplier.service';
import type { UserRegistrationService } from '../../core/user/user-registration.service';
import type { PartyFixture, PlanFixture, RoleFixture } from './fixtures';
import {
  fixtureKey,
  PLAN_LABELS,
  retiredFixtureKey,
  TestAccountsMode,
  TestCargo,
  TestFamily,
  TestPlanType,
  testAccountEmail,
  testCompanyName,
} from './options';

/**
 * Garante uma conta de teste: empresa pelo mesmo caminho do cadastro (sem a
 * verificação de e-mail), assinatura `manual_` ACTIVE no plano da fixture,
 * empresa desbloqueada, cargos com as permissões da fixture, um usuário por
 * cargo e os dados fictícios.
 *
 * Idempotente: a conta é achada pelo e-mail do administrador; colaboradores
 * e dados, pelo `legacyId` com o prefixo da família (`demo:`/`e2e:`); cargos e
 * perfil de vendedor, pelo nome. Nada é apagado: --refazer-dados (só e2e)
 * aposenta os dados da fixture (inativos, com o `legacyId` liberado) e cria
 * de novo.
 *
 * A assinatura `manual_` não tem cobrança no Asaas: o cron de bloqueio a pula
 * (billing-mode.ts, isBilledByGateway) e só o superadmin a bloqueia à mão —
 * o que o próximo --garantir desfaz.
 */

const MANUAL_PREFIX = 'manual_';
/** A assinatura vale um ano; o --garantir a renova quando faltar menos de 30 dias. */
const SUBSCRIPTION_DAYS = 365;
const SUBSCRIPTION_RENEW_BELOW_DAYS = 30;
/** Série dos orçamentos da fixture: V1 "Vendas Diversas" (a T1 é de treinamento). */
const SALE_SERIES_CODE = 'V1';
const ADMIN_NAME = 'Administrador (teste)';
const DAY_MS = 86_400_000;

export interface TestAccountDeps {
  prisma: PrismaClient;
  companyService: Pick<
    CompanyService,
    'createMainCompany' | 'createFirstAccess'
  >;
  employeeService: Pick<EmployeeService, 'create'>;
  userRegistration: Pick<UserRegistrationService, 'createUserForEmployee'>;
  planControl: Pick<PlanControlService, 'enforceUserLimit'>;
  clientService: Pick<ClientService, 'create'>;
  supplierService: Pick<SupplierService, 'create'>;
  quotationService: Pick<QuotationService, 'create'>;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (hash: string, password: string) => Promise<boolean>;
  now?: () => Date;
  newId?: () => string;
}

export interface TestAccountTarget {
  family: TestFamily;
  fixture: PlanFixture;
  emailDomain: string;
  password: string;
  mode: TestAccountsMode;
  dryRun: boolean;
}

export type DataKind = 'clientes' | 'fornecedores' | 'orcamentos';

export interface DataCount {
  existentes: number;
  /** Criados (ou, no dry-run, a criar). */
  criados: number;
  /** Aposentados por --refazer-dados. */
  aposentados: number;
}

export interface TestAccountReport {
  family: TestFamily;
  planType: TestPlanType;
  adminEmail: string;
  companyName: string;
  companyId: string | null;
  /** `nova`: não existe e o dry-run não a criou. */
  outcome: 'criada' | 'conferida' | 'nova' | 'falhou';
  subscription: string | null;
  users: Partial<Record<TestCargo, string>>;
  data: Record<DataKind, DataCount>;
  /** O que mudou ou, no dry-run, o que mudaria. */
  changes: string[];
  errors: string[];
}

const EMPLOYEE_SELECT = {
  id: true,
  companyId: true,
  isActive: true,
  roleId: true,
  sectorId: true,
  sellerProfileId: true,
  legacyId: true,
} satisfies Prisma.EmployeeSelect;

const USER_SELECT = {
  id: true,
  email: true,
  password: true,
  isActive: true,
  employee: { select: EMPLOYEE_SELECT },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type EmployeeRow = Prisma.EmployeeGetPayload<{
  select: typeof EMPLOYEE_SELECT;
}>;

interface RoleRef {
  id: string;
  sectorId: string;
}

interface Ctx {
  deps: TestAccountDeps;
  target: TestAccountTarget;
  report: TestAccountReport;
  now: Date;
  companyId: string;
  adminUserId: string;
  /** Chaves aposentadas nesta execução (no dry-run, só marcadas). */
  retired: Set<string>;
  /**
   * Dry-run sem a assinatura `manual_` ainda: a conferência do limite de
   * usuários falharia por falta de assinatura, então fica para a execução.
   */
  subscriptionPending: boolean;
}

const KIND_LABEL: Record<DataKind, string> = {
  clientes: 'cliente(s)',
  fornecedores: 'fornecedor(es)',
  orcamentos: 'orçamento(s)',
};

function emptyCount(): DataCount {
  return { existentes: 0, criados: 0, aposentados: 0 };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function samePermissions(current: string[], desired: string[]): boolean {
  const a = [...(current ?? [])].sort();
  const b = [...desired].sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** A mensagem de um erro, inclusive o corpo dos 4xx do Nest (code + message). */
export function errorMessage(error: unknown): string {
  const anyError = error as any;
  const response =
    typeof anyError?.getResponse === 'function' ? anyError.getResponse() : null;
  if (response && typeof response === 'object' && response.message) {
    return response.code
      ? `${response.code}: ${response.message}`
      : String(response.message);
  }
  return anyError?.message ? String(anyError.message) : String(error);
}

function change(ctx: Ctx, text: string) {
  ctx.report.changes.push(text);
}

function findUserByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<UserRow | null> {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: USER_SELECT,
  });
}

export async function ensureTestAccount(
  deps: TestAccountDeps,
  target: TestAccountTarget,
): Promise<TestAccountReport> {
  const { family, fixture } = target;
  const report: TestAccountReport = {
    family,
    planType: fixture.planType,
    adminEmail: testAccountEmail(
      'admin',
      family,
      fixture.planType,
      target.emailDomain,
    ),
    companyName: testCompanyName(family, fixture.planType),
    companyId: null,
    outcome: 'conferida',
    subscription: null,
    users: {},
    data: {
      clientes: emptyCount(),
      fornecedores: emptyCount(),
      orcamentos: emptyCount(),
    },
    changes: [],
    errors: [],
  };

  try {
    // Antes de qualquer leitura ou escrita: as contas demo-* guardam o que o
    // Maicol alterou e nunca têm os dados refeitos.
    if (target.mode === 'refazer-dados' && family !== 'e2e') {
      throw new Error(
        '--refazer-dados só vale para a família e2e: as contas demo-* guardam o que o Maicol alterou',
      );
    }

    let admin = await findUserByEmail(deps.prisma, report.adminEmail);
    let companyId: string;

    if (!admin) {
      if (target.dryRun) {
        describeNewAccount(target, report);
        return report;
      }
      ({ admin, companyId } = await createAccount(deps, target, report));
      report.outcome = 'criada';
    } else {
      companyId = await ownedCompanyId(deps.prisma, admin);
    }
    report.companyId = companyId;

    const ctx: Ctx = {
      deps,
      target,
      report,
      now: deps.now?.() ?? new Date(),
      companyId,
      adminUserId: admin.id,
      retired: new Set(),
      subscriptionPending: false,
    };

    await ensureCompanyState(ctx);
    await ensureSubscription(ctx);
    const roles = await ensureRoles(ctx);
    const employees = await ensureUsers(ctx, admin, roles);
    if (target.mode === 'refazer-dados') {
      await retireFixtureData(ctx);
    }
    await ensureData(ctx, employees.get('vendedor') ?? employees.get('admin'));
  } catch (error) {
    report.outcome = 'falhou';
    report.errors.push(errorMessage(error));
  }

  return report;
}

/** Dry-run de conta que não existe: diz o que seria criado, sem consultar mais nada. */
function describeNewAccount(
  target: TestAccountTarget,
  report: TestAccountReport,
) {
  const { fixture } = target;
  report.outcome = 'nova';
  report.subscription = `${MANUAL_PREFIX} (a criar) · ${PLAN_LABELS[fixture.planType]}`;
  report.users.admin = 'a criar';
  for (const role of fixture.roles) {
    report.users[role.cargo] = 'a criar';
  }
  report.data.clientes.criados = fixture.clients.length;
  report.data.fornecedores.criados = fixture.suppliers.length;
  report.data.orcamentos.criados = fixture.quotations.length;
  report.changes.push(
    `cria a conta: administrador, empresa "${report.companyName}" (com os itens padrão do cadastro) e primeiro acesso`,
    `cria a assinatura ${MANUAL_PREFIX} ACTIVE no plano ${PLAN_LABELS[fixture.planType]} com ${plural(fixture.additionalUsers, 'usuário adicional', 'usuários adicionais')}`,
    `cria os cargos e usuários: ${fixture.roles.map((role) => role.roleName).join(', ')}`,
  );
}

/**
 * Os passos do cadastro (UserRegistrationService.createPassword), sem a
 * verificação de e-mail e sem a assinatura TRIAL: usuário → empresa com os
 * itens padrão → primeiro acesso (titular, cargo Admin, colaborador).
 */
async function createAccount(
  deps: TestAccountDeps,
  target: TestAccountTarget,
  report: TestAccountReport,
): Promise<{ admin: UserRow; companyId: string }> {
  const { prisma, companyService } = deps;
  const email = report.adminEmail;

  const user = await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      email,
      password: await deps.hashPassword(target.password),
      isActive: true,
      isVerified: true,
    },
    select: { id: true },
  });

  let companyId: string | null = null;
  try {
    const company = await companyService.createMainCompany(email, {
      general: {
        name: report.companyName,
        legalName: report.companyName,
        cnpj: '',
        email,
        siteUrl: '',
        municipalRegistration: '',
        phone: '',
        mobile: '',
      },
      address: {
        street: '',
        number: '',
        neighborhood: '',
        city: '',
        state: '',
        zipcode: '',
      },
    } as CreateCompanyDto);
    companyId = company.id;
    await companyService.createFirstAccess(email, companyId);
  } catch (error) {
    // Como no cadastro: desfaz o que nasceu, para a próxima execução
    // recomeçar do zero em vez de achar um usuário sem empresa.
    if (companyId) {
      await prisma.company
        .delete({ where: { id: companyId } })
        .catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    throw error;
  }

  report.changes.push(
    `cria a conta: administrador, empresa "${report.companyName}" (com os itens padrão do cadastro) e primeiro acesso`,
  );

  const admin = await findUserByEmail(prisma, email);
  if (!admin) {
    throw new Error(`o administrador ${email} sumiu logo depois de criado`);
  }
  return { admin, companyId };
}

/** A empresa principal de que o administrador é titular. */
async function ownedCompanyId(
  prisma: PrismaClient,
  admin: UserRow,
): Promise<string> {
  const company = await prisma.company.findFirst({
    where: { ownerUserId: admin.id, principalCompanyId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!company) {
    throw new Error(
      `o usuário ${admin.email} existe, mas não é titular de nenhuma empresa principal: confira a conta à mão`,
    );
  }
  return company.id;
}

async function ensureCompanyState(ctx: Ctx) {
  const { prisma } = ctx.deps;
  const company = await prisma.company.findUnique({
    where: { id: ctx.companyId },
    select: {
      isActive: true,
      blockLevel: true,
      blockedAt: true,
      blockReason: true,
    },
  });
  if (!company) {
    throw new Error(`empresa ${ctx.companyId} não encontrada`);
  }

  const blocked =
    company.blockLevel !== 'NONE' ||
    !!company.blockedAt ||
    !!company.blockReason;
  if (!blocked && company.isActive) return;

  change(
    ctx,
    [
      blocked
        ? `desbloqueia a empresa (blockLevel ${company.blockLevel} → NONE)`
        : '',
      company.isActive ? '' : 'reativa a empresa',
    ]
      .filter(Boolean)
      .join('; '),
  );
  if (ctx.target.dryRun) return;
  await prisma.company.update({
    where: { id: ctx.companyId },
    data: {
      isActive: true,
      blockLevel: 'NONE',
      blockedAt: null,
      blockReason: null,
    },
  });
}

function isManualSubscription(subscription: {
  billingMode: string | null;
  asaasSubscriptionId: string;
}): boolean {
  return (
    billingModeOf(subscription) === 'MANUAL' &&
    subscription.asaasSubscriptionId.startsWith(MANUAL_PREFIX)
  );
}

/**
 * Uma assinatura `manual_` ACTIVE no plano global da fixture, com os usuários
 * adicionais da fixture e vencimento longe; as outras ACTIVE da empresa são
 * inativadas (com duas ACTIVE, o plano da sessão sairia de qualquer uma).
 */
async function ensureSubscription(ctx: Ctx) {
  const { prisma } = ctx.deps;
  const { fixture, dryRun } = ctx.target;

  const plan = await prisma.plan.findFirst({
    where: { planType: fixture.planType, companyId: null },
    orderBy: { order: 'asc' },
    select: { id: true, name: true, basePrice: true },
  });
  if (!plan) {
    throw new Error(
      `plano global ${fixture.planType} não encontrado (o seed cria os planos no boot)`,
    );
  }

  const active = await prisma.subscription.findMany({
    where: { companyId: ctx.companyId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      asaasSubscriptionId: true,
      billingMode: true,
      planId: true,
      additionalUsers: true,
      nextDueDate: true,
    },
  });
  const manual = active.find(isManualSubscription);
  const extraUsers = fixture.additionalUsers;
  const usersLabel = extraUsers
    ? ` · +${plural(extraUsers, 'usuário', 'usuários')}`
    : '';

  if (!manual) {
    const customerId = await ensureManualCustomer(ctx);
    change(
      ctx,
      `cria a assinatura ${MANUAL_PREFIX} ACTIVE no plano ${plan.name} com ${plural(extraUsers, 'usuário adicional', 'usuários adicionais')}`,
    );
    ctx.report.subscription = `${MANUAL_PREFIX} (a criar) · ${plan.name}${usersLabel}`;
    ctx.subscriptionPending = dryRun;
    if (!dryRun) {
      const created = await prisma.subscription.create({
        data: {
          customerId,
          planId: plan.id,
          companyId: ctx.companyId,
          additionalUsers: extraUsers,
          asaasSubscriptionId: `${MANUAL_PREFIX}${ctx.deps.newId?.() ?? randomUUID()}`,
          billingMode: 'MANUAL',
          nextDueDate: addDays(ctx.now, SUBSCRIPTION_DAYS),
          cycle: 'MONTHLY',
          billingType: 'CREDIT_CARD',
          value: plan.basePrice > 0 ? plan.basePrice / 100 : 0,
          status: 'ACTIVE',
        },
        select: { asaasSubscriptionId: true },
      });
      ctx.report.subscription = `${created.asaasSubscriptionId} · ${plan.name}${usersLabel}`;
    }
  } else {
    const data: Prisma.SubscriptionUncheckedUpdateInput = {};
    const what: string[] = [];
    if (manual.planId !== plan.id) {
      data.planId = plan.id;
      what.push(`plano → ${plan.name}`);
    }
    if (manual.additionalUsers !== extraUsers) {
      data.additionalUsers = extraUsers;
      what.push(
        `usuários adicionais ${manual.additionalUsers} → ${extraUsers}`,
      );
    }
    if (manual.billingMode !== 'MANUAL') {
      data.billingMode = 'MANUAL';
      what.push('billingMode → MANUAL');
    }
    if (
      manual.nextDueDate.getTime() <
      addDays(ctx.now, SUBSCRIPTION_RENEW_BELOW_DAYS).getTime()
    ) {
      data.nextDueDate = addDays(ctx.now, SUBSCRIPTION_DAYS);
      what.push('vencimento renovado por um ano');
    }
    if (what.length > 0) {
      change(
        ctx,
        `ajusta a assinatura ${manual.asaasSubscriptionId}: ${what.join(', ')}`,
      );
      if (!dryRun) {
        await prisma.subscription.update({ where: { id: manual.id }, data });
      }
    }
    ctx.report.subscription = `${manual.asaasSubscriptionId} · ${plan.name}${usersLabel}`;
  }

  for (const other of active.filter((s) => s !== manual)) {
    change(
      ctx,
      `inativa a outra assinatura ACTIVE da empresa (${other.asaasSubscriptionId})`,
    );
    if (!dryRun) {
      await prisma.subscription.update({
        where: { id: other.id },
        data: { status: 'INACTIVE' },
      });
    }
  }
}

/** Cliente de cobrança `manual_` (sem Asaas), como o do assign-manual. */
async function ensureManualCustomer(ctx: Ctx): Promise<string | null> {
  const { prisma } = ctx.deps;
  const candidates = await prisma.customer.findMany({
    where: {
      companyId: ctx.companyId,
      OR: [
        { asaasCustomerId: { startsWith: MANUAL_PREFIX } },
        { email: ctx.report.adminEmail },
      ],
    },
    select: { id: true, asaasCustomerId: true },
  });
  const existing =
    candidates.find((c) => c.asaasCustomerId.startsWith(MANUAL_PREFIX)) ??
    candidates[0];
  if (existing) return existing.id;

  change(ctx, `cria o cliente de cobrança ${MANUAL_PREFIX} (sem Asaas)`);
  if (ctx.target.dryRun) return null;
  const created = await prisma.customer.create({
    data: {
      name: ctx.report.companyName,
      email: ctx.report.adminEmail,
      document: `temp_${ctx.companyId}`,
      asaasCustomerId: `${MANUAL_PREFIX}${ctx.deps.newId?.() ?? randomUUID()}`,
      companyId: ctx.companyId,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Os cargos da fixture, achados pelo nome (o Vendedor é um dos cargos padrão
 * da empresa nova) e com as permissões regravadas. `null` no dry-run, para o
 * cargo que ainda não existe.
 */
async function ensureRoles(
  ctx: Ctx,
): Promise<Map<RoleFixture['cargo'], RoleRef | null>> {
  const { prisma } = ctx.deps;
  const roles = new Map<RoleFixture['cargo'], RoleRef | null>();

  for (const role of ctx.target.fixture.roles) {
    try {
      const sector = await prisma.companySector.findFirst({
        where: { companyId: ctx.companyId, name: role.sectorName },
        select: { id: true },
      });
      if (!sector) {
        throw new Error(`setor "${role.sectorName}" não existe na empresa`);
      }

      const existing = await prisma.role.findFirst({
        where: { companyId: ctx.companyId, name: role.roleName },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          permissions: true,
          isActive: true,
          isAdmin: true,
          sectorId: true,
        },
      });

      if (!existing) {
        change(
          ctx,
          `cria o cargo ${role.roleName} com as permissões da fixture`,
        );
        if (ctx.target.dryRun) {
          roles.set(role.cargo, null);
          continue;
        }
        const created = await prisma.role.create({
          data: {
            name: role.roleName,
            companyId: ctx.companyId,
            sectorId: sector.id,
            permissions: role.permissions,
            isActive: true,
            isAdmin: false,
          },
          select: { id: true },
        });
        roles.set(role.cargo, { id: created.id, sectorId: sector.id });
        continue;
      }

      if (
        !samePermissions(existing.permissions, role.permissions) ||
        !existing.isActive ||
        existing.isAdmin
      ) {
        change(
          ctx,
          `regrava as permissões do cargo ${role.roleName} conforme a fixture`,
        );
        if (!ctx.target.dryRun) {
          await prisma.role.update({
            where: { id: existing.id },
            data: {
              permissions: role.permissions,
              isActive: true,
              isAdmin: false,
            },
          });
        }
      }
      roles.set(role.cargo, {
        id: existing.id,
        sectorId: existing.sectorId ?? sector.id,
      });
    } catch (error) {
      roles.set(role.cargo, null);
      ctx.report.errors.push(`cargo ${role.roleName}: ${errorMessage(error)}`);
    }
  }

  return roles;
}

async function ensureSellerProfile(
  ctx: Ctx,
  role: RoleFixture,
): Promise<string | null> {
  if (!role.sellerProfile) return null;
  const { prisma } = ctx.deps;
  const profile = role.sellerProfile;

  const existing = await prisma.sellerProfile.findFirst({
    where: { companyId: ctx.companyId, name: profile.name },
    select: { id: true },
  });
  if (existing) return existing.id;

  change(ctx, `cria o perfil de vendedor ${profile.name}`);
  if (ctx.target.dryRun) return null;
  const created = await prisma.sellerProfile.create({
    data: {
      name: profile.name,
      companyId: ctx.companyId,
      commission: profile.commission,
      maxDiscount: profile.maxDiscount,
      minValue: profile.minValue,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Um usuário por cargo: o Administrador (titular, do primeiro acesso) e os
 * da fixture. Devolve o colaborador de cada cargo, para os orçamentos.
 */
async function ensureUsers(
  ctx: Ctx,
  admin: UserRow,
  roles: Map<RoleFixture['cargo'], RoleRef | null>,
): Promise<Map<TestCargo, string>> {
  const employees = new Map<TestCargo, string>();

  const adminEmployee = admin.employee.find(
    (employee) => employee.companyId === ctx.companyId,
  );
  try {
    if (!adminEmployee) {
      throw new Error(
        `o administrador ${admin.email} não tem colaborador nesta empresa`,
      );
    }
    ctx.report.users.admin = await reaffirmAccess(
      ctx,
      admin,
      adminEmployee,
      {},
    );
    employees.set('admin', adminEmployee.id);
  } catch (error) {
    ctx.report.users.admin = 'falhou';
    ctx.report.errors.push(`admin: ${errorMessage(error)}`);
  }

  for (const role of ctx.target.fixture.roles) {
    try {
      const result = await ensureCargoUser(ctx, role, roles.get(role.cargo));
      ctx.report.users[role.cargo] = result.status;
      if (result.employeeId) employees.set(role.cargo, result.employeeId);
    } catch (error) {
      ctx.report.users[role.cargo] = 'falhou';
      ctx.report.errors.push(`${role.cargo}: ${errorMessage(error)}`);
    }
  }

  return employees;
}

async function ensureCargoUser(
  ctx: Ctx,
  role: RoleFixture,
  roleRef: RoleRef | null,
): Promise<{ status: string; employeeId: string | null }> {
  const { prisma, planControl } = ctx.deps;
  const { family, fixture, emailDomain, password, dryRun } = ctx.target;
  const email = testAccountEmail(
    role.cargo,
    family,
    fixture.planType,
    emailDomain,
  );
  const key = fixtureKey(family, 'usuario', role.cargo);

  const user = await findUserByEmail(prisma, email);
  let employee: EmployeeRow | null = null;
  if (user) {
    employee =
      user.employee.find((item) => item.companyId === ctx.companyId) ?? null;
    if (!employee) {
      throw new Error(`o e-mail ${email} já é de um usuário de outra conta`);
    }
  } else {
    // Colaborador sem usuário: sobra de uma execução interrompida.
    employee = await prisma.employee.findFirst({
      where: { companyId: ctx.companyId, legacyId: key },
      select: EMPLOYEE_SELECT,
    });
  }

  const sellerProfileId = await ensureSellerProfile(ctx, role);
  const desired = {
    roleId: roleRef?.id,
    sectorId: roleRef?.sectorId,
    sellerProfileId: role.sellerProfile ? sellerProfileId : undefined,
    legacyId: key,
  };

  if (!user) {
    if (!roleRef && !dryRun) {
      throw new Error(
        `sem o cargo ${role.roleName}, o usuário ${email} não foi criado`,
      );
    }
    // Dar acesso a mais uma pessoa respeita o limite do plano, como na rota
    // POST /user/employee (a conferência é só leitura: vale no dry-run).
    if (!ctx.subscriptionPending) {
      await planControl.enforceUserLimit(ctx.companyId);
    }
    change(ctx, `cria o usuário ${email} (cargo ${role.roleName})`);
    if (dryRun) {
      return { status: 'a criar', employeeId: employee?.id ?? null };
    }

    let employeeId = employee?.id;
    if (!employeeId) {
      const created = await ctx.deps.employeeService.create(
        {
          companyId: ctx.companyId,
          roleId: roleRef.id,
          sectorId: roleRef.sectorId,
          name: role.personName,
          email,
          sallary: '0',
        },
        ctx.adminUserId,
      );
      await prisma.employee.update({
        where: { id: created.id },
        data: { legacyId: key, sellerProfileId },
      });
      employeeId = created.id;
    }

    await ctx.deps.userRegistration.createUserForEmployee(
      {
        employeeId,
        email,
        name: role.personName,
        company: ctx.companyId,
        password,
      },
      ctx.adminUserId,
    );

    // O colaborador pode ser sobra de uma execução interrompida (inativo, em
    // outro cargo): passa pela mesma reafirmação de quem já existia.
    const createdUser = await findUserByEmail(prisma, email);
    const createdEmployee = createdUser?.employee.find(
      (item) => item.companyId === ctx.companyId,
    );
    if (!createdUser || !createdEmployee) {
      throw new Error(`o usuário ${email} não ficou ligado ao colaborador`);
    }
    const adjusted = await reaffirmAccess(
      ctx,
      createdUser,
      createdEmployee,
      desired,
    );
    return {
      status: adjusted === 'ok' ? 'criado' : `criado, ${adjusted}`,
      employeeId: createdEmployee.id,
    };
  }

  const status = await reaffirmAccess(ctx, user, employee, desired);
  return { status, employeeId: employee.id };
}

/**
 * Usuário existente: ativo, com a senha de TEST_ACCOUNTS_PASSWORD (trocar a
 * variável e rodar de novo troca a senha de todos) e o colaborador no cargo
 * da fixture.
 */
async function reaffirmAccess(
  ctx: Ctx,
  user: UserRow,
  employee: EmployeeRow,
  desired: {
    roleId?: string;
    sectorId?: string;
    sellerProfileId?: string | null;
    legacyId?: string;
  },
): Promise<string> {
  const { prisma, planControl } = ctx.deps;
  const { dryRun, password } = ctx.target;
  const done: string[] = [];

  if (!user.isActive || !employee.isActive) {
    // Reativar também conta no limite de usuários (PATCH /user/:id).
    if (!ctx.subscriptionPending) {
      await planControl.enforceUserLimit(ctx.companyId, user.id);
    }
    done.push('reativado');
    change(ctx, `reativa o usuário ${user.email}`);
    if (!dryRun) {
      if (!user.isActive) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isActive: true },
        });
      }
      if (!employee.isActive) {
        await prisma.employee.update({
          where: { id: employee.id },
          data: { isActive: true },
        });
      }
    }
  }

  if (!(await ctx.deps.verifyPassword(user.password, password))) {
    done.push('senha regravada');
    change(ctx, `regrava a senha de ${user.email}`);
    if (!dryRun) {
      await prisma.user.update({
        where: { id: user.id },
        data: { password: await ctx.deps.hashPassword(password) },
      });
    }
  }

  const data: Prisma.EmployeeUncheckedUpdateInput = {};
  if (desired.roleId && employee.roleId !== desired.roleId) {
    data.roleId = desired.roleId;
  }
  if (desired.sectorId && employee.sectorId !== desired.sectorId) {
    data.sectorId = desired.sectorId;
  }
  if (
    desired.sellerProfileId &&
    employee.sellerProfileId !== desired.sellerProfileId
  ) {
    data.sellerProfileId = desired.sellerProfileId;
  }
  if (desired.legacyId && !employee.legacyId) {
    data.legacyId = desired.legacyId;
  }
  if (Object.keys(data).length > 0) {
    done.push('cargo reafirmado');
    change(ctx, `devolve ${user.email} ao cargo e perfil da fixture`);
    if (!dryRun) {
      await prisma.employee.update({ where: { id: employee.id }, data });
    }
  }

  return done.length > 0 ? done.join(', ') : 'ok';
}

/**
 * --refazer-dados (só e2e): aposenta os dados da fixture — inativos, com o
 * `legacyId` renomeado — para o --garantir criar de novo. Nada é apagado: a
 * automação pode ter ligado O.S., financeiro ou itens a eles.
 */
async function retireFixtureData(ctx: Ctx) {
  const { prisma } = ctx.deps;
  // A família já foi conferida no início (só e2e chega aqui).
  const { family, fixture, dryRun } = ctx.target;

  let total = 0;
  const retire = async (
    kind: DataKind,
    key: string,
    find: () => Promise<{ id: string } | null>,
    update: (id: string, retiredKey: string) => Promise<unknown>,
  ) => {
    const record = await find();
    if (!record) return;
    ctx.retired.add(key);
    ctx.report.data[kind].aposentados++;
    total++;
    if (!dryRun) await update(record.id, retiredFixtureKey(key, ctx.now));
  };

  for (const quotation of fixture.quotations) {
    const key = fixtureKey(family, 'orcamento', quotation.ref);
    await retire(
      'orcamentos',
      key,
      () =>
        prisma.quotation.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      (id, retiredKey) =>
        prisma.quotation.update({
          where: { id },
          data: { legacyId: retiredKey, isActive: false },
        }),
    );
  }
  for (const supplier of fixture.suppliers) {
    const key = fixtureKey(family, 'fornecedor', supplier.ref);
    await retire(
      'fornecedores',
      key,
      () =>
        prisma.supplier.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      (id, retiredKey) =>
        prisma.supplier.update({
          where: { id },
          data: { legacyId: retiredKey, status: 'INACTIVE' },
        }),
    );
  }
  for (const client of fixture.clients) {
    const key = fixtureKey(family, 'cliente', client.ref);
    await retire(
      'clientes',
      key,
      () =>
        prisma.client.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      (id, retiredKey) =>
        prisma.client.update({
          where: { id },
          data: { legacyId: retiredKey, status: 'INACTIVE' },
        }),
    );
  }

  if (total > 0) {
    change(
      ctx,
      `aposenta ${plural(total, 'dado', 'dados')} da fixture (inativos, legacyId liberado) para criar de novo`,
    );
  }
}

function partyDto(party: PartyFixture, companyId: string) {
  return {
    type: party.type,
    general: {
      name: party.name,
      corporateName: party.corporateName,
      email: party.email,
      mobile: party.mobile,
      activity: party.activity,
      notes: party.notes,
      isBranch: false,
    },
    addresses: [],
    contacts: [],
    creditLimit: {
      minValue: 0,
      maxValue: 0,
      conditions: [],
      blockClient: false,
    },
    companyId,
  };
}

/**
 * Clientes, fornecedores e orçamentos da fixture, pelos serviços da API e
 * marcados com o `legacyId` da família. O que já existe não é tocado: o que
 * o Maicol alterou continua como está.
 */
async function ensureData(ctx: Ctx, sellerEmployeeId: string | undefined) {
  const { prisma, clientService, supplierService } = ctx.deps;
  const { family, fixture } = ctx.target;

  const clientIds = await ensureRecords(
    ctx,
    'clientes',
    fixture.clients.map((party) => ({
      ref: party.ref,
      key: fixtureKey(family, 'cliente', party.ref),
      label: `cliente ${party.name}`,
      find: (key: string) =>
        prisma.client.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      create: async (key: string) => {
        await clientService.create(
          partyDto(party, ctx.companyId) as CreateClientDto,
        );
        // O serviço devolve o cadastro no formato da tela, sem o id: o
        // recém-criado é o mais novo da empresa com esse nome e sem legacyId.
        const created = await prisma.client.findFirst({
          where: { companyId: ctx.companyId, name: party.name, legacyId: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!created) {
          throw new Error('criado, mas não encontrado para gravar o legacyId');
        }
        await prisma.client.update({
          where: { id: created.id },
          data: { legacyId: key },
        });
        return created.id;
      },
    })),
  );

  await ensureRecords(
    ctx,
    'fornecedores',
    fixture.suppliers.map((party) => ({
      ref: party.ref,
      key: fixtureKey(family, 'fornecedor', party.ref),
      label: `fornecedor ${party.name}`,
      find: (key: string) =>
        prisma.supplier.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      create: async (key: string) => {
        await supplierService.create(
          partyDto(party, ctx.companyId) as CreateSupplierDto,
        );
        const created = await prisma.supplier.findFirst({
          where: { companyId: ctx.companyId, name: party.name, legacyId: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!created) {
          throw new Error('criado, mas não encontrado para gravar o legacyId');
        }
        await prisma.supplier.update({
          where: { id: created.id },
          data: { legacyId: key },
        });
        return created.id;
      },
    })),
  );

  if (fixture.quotations.length === 0) return;
  const series = await prisma.saleSeries.findFirst({
    where: { companyId: ctx.companyId, code: SALE_SERIES_CODE },
    select: { id: true },
  });

  await ensureRecords(
    ctx,
    'orcamentos',
    fixture.quotations.map((quotation) => ({
      ref: quotation.ref,
      key: fixtureKey(family, 'orcamento', quotation.ref),
      label: `orçamento "${quotation.description}"`,
      find: (key: string) =>
        prisma.quotation.findFirst({
          where: { companyId: ctx.companyId, legacyId: key },
          select: { id: true },
        }),
      create: async (key: string) => {
        if (!series) {
          throw new Error(`a série ${SALE_SERIES_CODE} não existe na empresa`);
        }
        const clientId = clientIds.get(quotation.clientRef);
        if (!clientId) {
          throw new Error(
            `o cliente ${quotation.clientRef} da fixture não existe`,
          );
        }
        if (!sellerEmployeeId) {
          throw new Error('nenhum colaborador para ser o vendedor');
        }
        // O serviço da rota POST /sale/quotation: só banco (série, entrega,
        // pagamento e histórico), sem e-mail, PDF ou integração.
        const created = await ctx.deps.quotationService.create(
          {
            companyId: ctx.companyId,
            subCompanyId: ctx.companyId,
            sellerId: sellerEmployeeId,
            clientId,
            seriesId: series.id,
            description: quotation.description,
          },
          ctx.adminUserId,
        );
        await prisma.quotation.update({
          where: { id: created.id },
          data: { legacyId: key },
        });
        return created.id;
      },
    })),
  );
}

interface RecordSpec {
  ref: string;
  key: string;
  label: string;
  find: (key: string) => Promise<{ id: string } | null>;
  create: (key: string) => Promise<string>;
}

/** Cria o que falta de uma lista da fixture. Devolve os ids por `ref`. */
async function ensureRecords(
  ctx: Ctx,
  kind: DataKind,
  specs: RecordSpec[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const count = ctx.report.data[kind];
  let created = 0;

  for (const spec of specs) {
    try {
      const existing = await spec.find(spec.key);
      if (existing && !ctx.retired.has(spec.key)) {
        count.existentes++;
        ids.set(spec.ref, existing.id);
        continue;
      }
      count.criados++;
      created++;
      if (ctx.target.dryRun) continue;
      ids.set(spec.ref, await spec.create(spec.key));
    } catch (error) {
      ctx.report.errors.push(`${spec.label}: ${errorMessage(error)}`);
    }
  }

  if (created > 0) {
    change(ctx, `cria ${created} ${KIND_LABEL[kind]} da fixture`);
  }
  return ids;
}

function dataCell(count: DataCount, dryRun: boolean): string {
  const total = count.existentes + count.criados;
  const parts = [`${total}`];
  if (count.criados > 0) {
    parts.push(dryRun ? `${count.criados} a criar` : `${count.criados} novos`);
  }
  if (count.aposentados > 0) {
    parts.push(
      dryRun
        ? `${count.aposentados} a aposentar`
        : `${count.aposentados} aposentados`,
    );
  }
  return parts.length > 1
    ? `${parts[0]} (${parts.slice(1).join(', ')})`
    : parts[0];
}

/** Saída do script: uma tabela para colar no roteiro, as mudanças e os erros. */
export function formatReport(
  reports: TestAccountReport[],
  info: {
    mode: TestAccountsMode;
    dryRun: boolean;
    fixturesVersion: string;
    emailDomain: string;
  },
): string {
  const lines: string[] = [];
  lines.push(
    `Contas de teste — fixtures ${info.fixturesVersion} — modo ${info.mode}${info.dryRun ? ' (dry-run: nada foi gravado)' : ''}`,
    `Usuários: <cargo>.<família>-<plano>@${info.emailDomain} (cargos admin, vendedor, producao e, do LITE para cima, caixa); senha: TEST_ACCOUNTS_PASSWORD.`,
    '',
    '| Família | Plano | Administrador | Situação | Assinatura | Usuários | Clientes | Fornecedores | Orçamentos |',
    '|---|---|---|---|---|---|---|---|---|',
  );

  for (const report of reports) {
    const users = Object.entries(report.users)
      .map(([cargo, status]) => `${cargo} ${status}`)
      .join(' · ');
    lines.push(
      `| ${report.family} | ${report.planType} | ${report.adminEmail} | ${report.outcome} | ${report.subscription ?? '—'} | ${users || '—'} | ${dataCell(report.data.clientes, info.dryRun)} | ${dataCell(report.data.fornecedores, info.dryRun)} | ${dataCell(report.data.orcamentos, info.dryRun)} |`,
    );
  }

  const withChanges = reports.filter((report) => report.changes.length > 0);
  lines.push('', info.dryRun ? 'Mudanças que a execução faria:' : 'Mudanças:');
  if (withChanges.length === 0) {
    lines.push('  nenhuma: tudo já estava como a fixture.');
  }
  for (const report of withChanges) {
    lines.push(`  ${report.family}-${report.planType.toLowerCase()}:`);
    report.changes.forEach((item) => lines.push(`    - ${item}`));
  }

  const withErrors = reports.filter((report) => report.errors.length > 0);
  if (withErrors.length > 0) {
    lines.push('', 'Erros:');
    for (const report of withErrors) {
      lines.push(`  ${report.family}-${report.planType.toLowerCase()}:`);
      report.errors.forEach((item) => lines.push(`    - ${item}`));
    }
  }

  return lines.join('\n');
}

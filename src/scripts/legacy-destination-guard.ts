import { PrismaClient } from '@prisma/client';

/**
 * Garante que os dados de uma base legada tenham um único destino no Atrupe.
 *
 * A conta do cliente é criada à mão, e o vínculo com a base é o CNPJ. Nada no
 * cadastro impede duas contas com o mesmo CNPJ, e é aí que mora o risco: cada
 * uma receberia uma cópia do histórico do cliente, e as duas passariam a
 * divergir sem que ninguém percebesse.
 *
 * A regra é consultada em três lugares — a lista da tela, a criação da
 * execução e o próprio script —, então a mensagem precisa bastar para o
 * suporte resolver sem abrir o código.
 */

export interface CompanyRef {
  id: string;
  name: string;
  isActive?: boolean;
}

export function onlyDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^\d]/g, '');
}

/**
 * Impede a carga quando a base legada não é a do cliente que está na conta.
 *
 * É a proteção mais importante do script: sem ela, um nome de base trocado
 * despeja os dados de um cliente dentro da empresa de outro, e nada no
 * processo acusaria.
 */
export function assertSameCompany(
  legacyCompany: { nome?: string; razao_social?: string; cnpj?: string },
  newCompany: { name: string; cnpj: string | null },
): void {
  const legacyDoc = onlyDigits(legacyCompany?.cnpj);
  const newDoc = onlyDigits(newCompany?.cnpj);

  if (!legacyDoc || !newDoc) {
    throw new Error(
      `Não foi possível conferir a identidade da empresa: CNPJ ausente ` +
        `(legado: '${legacyCompany?.cnpj ?? ''}', novo: '${newCompany?.cnpj ?? ''}'). ` +
        `Preencha o CNPJ nos dois lados antes de migrar.`,
    );
  }

  if (legacyDoc !== newDoc) {
    throw new Error(
      `A base legada não corresponde à empresa da conta informada.\n` +
        `  Legado: ${legacyCompany.razao_social || legacyCompany.nome} — ${legacyCompany.cnpj}\n` +
        `  Novo:   ${newCompany.name} — ${newCompany.cnpj}\n` +
        `Confira o nome da base e o e-mail da conta.`,
    );
  }
}

function listCompanies(companies: CompanyRef[]): string {
  return companies
    .map(
      (c) => `${c.name} (${c.id})${c.isActive === false ? ' — inativa' : ''}`,
    )
    .join(', ');
}

/** Carga real já feita: qual base foi para qual conta. */
export interface RealLoad {
  base: string;
  company: CompanyRef;
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  return items.filter(
    (item, i) => items.findIndex((o) => key(o) === key(item)) === i,
  );
}

/**
 * Motivo para não migrar, ou `null` quando o destino é inequívoco.
 *
 * Cada base do legado deve ir para uma conta só, e cada conta deve receber uma
 * base só. O segundo sentido importa tanto quanto o primeiro: as bases numeram
 * os registros a partir do 1, e o vínculo de idempotência é o código do
 * legado dentro da conta — uma segunda base na mesma conta teria os registros
 * confundidos com os da primeira.
 */
export function findDestinationConflict(input: {
  base: string;
  /** Todas as contas cujo CNPJ é o da base legada. */
  sameCnpj: CompanyRef[];
  /** Cargas reais desta base ou para as contas acima. */
  loads: RealLoad[];
}): string | null {
  const { base, sameCnpj, loads } = input;

  if (sameCnpj.length > 1) {
    // Contas inativas contam: reativadas, dividiriam os dados com a outra.
    return (
      `O CNPJ desta base está cadastrado em ${sameCnpj.length} contas: ${listCompanies(sameCnpj)}. ` +
      `Corrija o CNPJ da conta que não deve receber os dados antes de migrar.`
    );
  }

  const destino = sameCnpj[0];

  const outrasContas = unique(
    loads
      .filter((l) => l.base === base && l.company.id !== destino?.id)
      .map((l) => l.company),
    (c) => c.id,
  );
  if (outrasContas.length > 0) {
    return (
      `Esta base já foi migrada para ${listCompanies(outrasContas)}. ` +
      `Migrar para outra conta duplicaria os dados do cliente. ` +
      `Se a carga anterior foi desfeita, acione o time de desenvolvimento.`
    );
  }

  const outrasBases = unique(
    loads
      .filter((l) => l.base !== base && l.company.id === destino?.id)
      .map((l) => l.base),
    (b) => b,
  );
  if (destino && outrasBases.length > 0) {
    return (
      `A conta ${listCompanies([destino])} já recebeu a base ${outrasBases.join(', ')}. ` +
      `Cada base do legado numera os registros a partir do 1, então os desta ` +
      `base seriam confundidos com os da anterior. Confirme com o cliente ` +
      `qual base está em uso.`
    );
  }

  return null;
}

/** Contas com o CNPJ informado, comparando só os dígitos. */
export async function companiesWithCnpj(
  prisma: Pick<PrismaClient, 'company'>,
  cnpj: string | null | undefined,
): Promise<CompanyRef[]> {
  const digits = onlyDigits(cnpj);
  if (!digits) return [];

  // O CNPJ é gravado com e sem máscara conforme a origem do cadastro, então a
  // comparação não pode ser feita pelo banco com igualdade simples.
  const empresas = await prisma.company.findMany({
    where: { cnpj: { not: null } },
    select: { id: true, name: true, cnpj: true, isActive: true },
  });

  return empresas
    .filter((e) => onlyDigits(e.cnpj) === digits)
    .map(({ id, name, isActive }) => ({ id, name, isActive }));
}

/**
 * Cargas reais das bases ou para as contas informadas, com ou sem sucesso.
 *
 * Uma carga que falhou no meio já gravou parte dos dados, então também conta.
 * Fica de fora só a que nem chegou a começar.
 */
export async function realLoads(
  prisma: Pick<PrismaClient, 'migrationRun'>,
  bases: string[],
  companyIds: string[],
): Promise<RealLoad[]> {
  const cargas = await prisma.migrationRun.findMany({
    where: {
      dryRun: false,
      startedAt: { not: null },
      OR: [{ legacyBase: { in: bases } }, { companyId: { in: companyIds } }],
    },
    select: {
      legacyBase: true,
      company: { select: { id: true, name: true, isActive: true } },
    },
  });
  return cargas.map((c) => ({ base: c.legacyBase, company: c.company }));
}

/** Motivo para não migrar a base, consultando contas e cargas anteriores. */
export async function destinationConflict(
  prisma: Pick<PrismaClient, 'company' | 'migrationRun'>,
  legacyBase: string,
  legacyCnpj: string | null | undefined,
): Promise<string | null> {
  const sameCnpj = await companiesWithCnpj(prisma, legacyCnpj);
  return findDestinationConflict({
    base: legacyBase,
    sameCnpj,
    loads: await realLoads(
      prisma,
      [legacyBase],
      sameCnpj.map((c) => c.id),
    ),
  });
}

export async function assertSingleDestination(
  prisma: Pick<PrismaClient, 'company' | 'migrationRun'>,
  legacyBase: string,
  legacyCnpj: string | null | undefined,
): Promise<void> {
  const conflito = await destinationConflict(prisma, legacyBase, legacyCnpj);
  if (conflito) throw new Error(conflito);
}

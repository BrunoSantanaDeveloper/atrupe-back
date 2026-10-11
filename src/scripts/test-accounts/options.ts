/**
 * Opções e nomes das contas de teste por plano: o que o script recebe da
 * linha de comando e do ambiente, e como ele nomeia contas, e-mails e dados.
 *
 * Tudo aqui é puro (sem banco), para ser testado sem infraestrutura.
 */

/** Planos com conta de teste, na ordem da trilha (o TRIAL é igual ao START por padrão). */
export const TEST_PLAN_TYPES = [
  'TRIAL',
  'START',
  'LITE',
  'PRO',
  'ELITE',
  'FULL',
] as const;
export type TestPlanType = (typeof TEST_PLAN_TYPES)[number];

/**
 * Famílias de contas: `demo` para o Maicol aprovar (dados curados; a
 * automação só faz login nelas) e `e2e` para a automação, que grava dados e
 * por isso pode ser recarregada com --refazer-dados.
 */
export const TEST_FAMILIES = ['demo', 'e2e'] as const;
export type TestFamily = (typeof TEST_FAMILIES)[number];

/** Cargos com usuário fixo. O Caixa só existe do LITE para cima. */
export const TEST_CARGOS = ['admin', 'vendedor', 'producao', 'caixa'] as const;
export type TestCargo = (typeof TEST_CARGOS)[number];

export type TestAccountsMode = 'garantir' | 'refazer-dados';

export interface TestAccountsOptions {
  mode: TestAccountsMode;
  dryRun: boolean;
  plans: TestPlanType[];
  families: TestFamily[];
}

export interface TestAccountsSettings {
  emailDomain: string;
  password: string;
}

export const PLAN_LABELS: Record<TestPlanType, string> = {
  TRIAL: 'Trial',
  START: 'Start',
  LITE: 'Lite',
  PRO: 'Pro',
  ELITE: 'Elite',
  FULL: 'Full',
};

/** Posição do plano na trilha: o que vale "do LITE para cima". */
export function planRank(planType: TestPlanType): number {
  // O TRIAL tem por padrão as chaves do START: para cargos e dados, vale como ele.
  return planType === 'TRIAL' ? 1 : TEST_PLAN_TYPES.indexOf(planType);
}

/** Erro de uso (opção inválida, variável faltando): sai sem tocar no banco. */
export class TestAccountsUsageError extends Error {}

const MIN_PASSWORD_LENGTH = 8;

function parseList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  option: string,
  normalize: (value: string) => string,
): T[] {
  const values = (raw ?? '')
    .split(',')
    .map((value) => normalize(value.trim()))
    .filter(Boolean);
  if (values.length === 0) {
    throw new TestAccountsUsageError(
      `${option} precisa de uma lista separada por vírgula (${allowed.join(',')}).`,
    );
  }
  const invalid = values.filter((value) => !allowed.includes(value as T));
  if (invalid.length > 0) {
    throw new TestAccountsUsageError(
      `${option}: valor desconhecido ${invalid.join(', ')} (use ${allowed.join(',')}).`,
    );
  }
  // Na ordem da trilha, sem repetição.
  return allowed.filter((value) => values.includes(value));
}

/**
 * Lê a linha de comando. Modo padrão: --garantir. --refazer-dados vale só
 * para a família e2e: as contas demo-* guardam o que o Maicol alterou.
 */
export function parseOptions(argv: string[]): TestAccountsOptions {
  let garantir = false;
  let refazer = false;
  let dryRun = false;
  let plans: TestPlanType[] | null = null;
  let families: TestFamily[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inlineValue] = arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined];

    switch (name) {
      case '--garantir':
        garantir = true;
        break;
      case '--refazer-dados':
        refazer = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--planos':
        plans = parseList(
          inlineValue ?? argv[++i],
          TEST_PLAN_TYPES,
          '--planos',
          (value) => value.toUpperCase(),
        );
        break;
      case '--familias':
        families = parseList(
          inlineValue ?? argv[++i],
          TEST_FAMILIES,
          '--familias',
          (value) => value.toLowerCase(),
        );
        break;
      default:
        throw new TestAccountsUsageError(`Opção desconhecida: ${arg}`);
    }
  }

  if (garantir && refazer) {
    throw new TestAccountsUsageError(
      'Use --garantir ou --refazer-dados, não os dois (--refazer-dados já garante as contas).',
    );
  }

  const mode: TestAccountsMode = refazer ? 'refazer-dados' : 'garantir';
  if (mode === 'refazer-dados') {
    if (families && families.some((family) => family !== 'e2e')) {
      throw new TestAccountsUsageError(
        '--refazer-dados só vale para a família e2e: as contas demo-* guardam o que o Maicol alterou.',
      );
    }
    families = ['e2e'];
  }

  return {
    mode,
    dryRun,
    plans: plans ?? [...TEST_PLAN_TYPES],
    families: families ?? [...TEST_FAMILIES],
  };
}

/**
 * Lê as variáveis obrigatórias: TEST_ACCOUNTS_EMAIL_DOMAIN (domínio de teste
 * da Atrupe, de preferência sem caixa postal) e TEST_ACCOUNTS_PASSWORD (a
 * senha de todos os usuários das contas; nunca vai para o log).
 */
export function readSettings(
  env: Record<string, string | undefined>,
): TestAccountsSettings {
  const problems: string[] = [];

  const emailDomain = (env.TEST_ACCOUNTS_EMAIL_DOMAIN ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (!emailDomain) {
    problems.push('TEST_ACCOUNTS_EMAIL_DOMAIN não definida.');
  } else if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(emailDomain)) {
    problems.push(
      `TEST_ACCOUNTS_EMAIL_DOMAIN inválido: "${emailDomain}" (esperado um domínio, como teste.exemplo.com.br).`,
    );
  }

  const password = env.TEST_ACCOUNTS_PASSWORD ?? '';
  if (!password.trim()) {
    problems.push('TEST_ACCOUNTS_PASSWORD não definida.');
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(
      `TEST_ACCOUNTS_PASSWORD precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }

  if (problems.length > 0) {
    throw new TestAccountsUsageError(problems.join('\n'));
  }
  return { emailDomain, password };
}

/** `<cargo>.<família>-<plano>@<domínio>`, por exemplo `vendedor.e2e-lite@…`. */
export function testAccountEmail(
  cargo: TestCargo,
  family: TestFamily,
  planType: TestPlanType,
  emailDomain: string,
): string {
  return `${cargo}.${family}-${planType.toLowerCase()}@${emailDomain}`;
}

/** Nome da empresa de teste: o prefixo [TESTE] a identifica em qualquer lista. */
export function testCompanyName(
  family: TestFamily,
  planType: TestPlanType,
): string {
  return `[TESTE] Comunicação Visual ${PLAN_LABELS[planType]} (${family})`;
}

export type FixtureKind = 'cliente' | 'fornecedor' | 'orcamento' | 'usuario';

/**
 * Código estável de um dado da fixture, gravado em `legacyId` (índice único
 * por empresa): é o que torna o script idempotente. O prefixo é a família
 * (`demo:` ou `e2e:`), e nunca colide com a migração do legado, que só
 * carrega empresas migradas.
 */
export function fixtureKey(
  family: TestFamily,
  kind: FixtureKind,
  ref: string,
): string {
  return `${family}:${kind}:${ref}`;
}

/**
 * Código de um dado aposentado por --refazer-dados: libera o `legacyId` da
 * fixture para o dado novo e deixa o antigo rastreável.
 */
export function retiredFixtureKey(key: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  return `${key}~refeito-${stamp}`;
}

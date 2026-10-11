/**
 * Guarda tripla das contas de teste.
 *
 * O script cria empresas com assinatura ACTIVE sem cobrança e usuários com
 * senha conhecida: em produção seria uma conta grátis com todos os recursos.
 * Por isso ele só roda com três condições independentes, conferidas aqui
 * dentro — e não no shell, porque o start.sh roda também em produção:
 *
 *  1. TEST_ACCOUNTS_ENABLED=true, variável que só o ambiente de homolog define;
 *  2. APP_ENV definida e diferente de production;
 *  3. o Asaas ativo em sandbox (system_settings.asaas_config, com recaída no
 *     ASAAS_TOKEN do ambiente — SystemSettingsService.getAsaasConfig) E o
 *     banco do DATABASE_URL com nome diferente do de produção.
 *
 * A conferência vale também para --dry-run, que só não grava.
 */

/**
 * Nome do banco de produção: o padrão do backup do deploy de produção
 * (`${DB_NAME:-atrupeDb}` em .github/workflows/ci-cd.yml; o de homolog é
 * atrupeDbDev). A comparação ignora maiúsculas. O docker-compose.local.yml
 * também usa atrupeDb: localmente, rode o script num banco com outro nome.
 */
export const PRODUCTION_DATABASE_NAMES = ['atrupeDb'];

export type GuardName =
  | 'TEST_ACCOUNTS_ENABLED'
  | 'APP_ENV'
  | 'ASAAS_SANDBOX'
  | 'DATABASE_NAME';

export interface GuardFailure {
  guard: GuardName;
  message: string;
}

/** O formato de `SystemSettingsService.getAsaasConfig()`, sem os tokens. */
export interface AsaasEnvironmentState {
  environment: string;
  sandbox?: { url?: string };
  production?: { url?: string };
}

const GUARD_NUMBER: Record<GuardName, string> = {
  TEST_ACCOUNTS_ENABLED: '1',
  APP_ENV: '2',
  ASAAS_SANDBOX: '3',
  DATABASE_NAME: '3',
};

/** Nome do banco no DATABASE_URL (`postgresql://…/<nome>?schema=…`). */
export function databaseNameFromUrl(url: string | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    const name = decodeURIComponent(
      new URL(url.trim()).pathname.replace(/^\/+/, ''),
    );
    return name || null;
  } catch {
    return null;
  }
}

/** Guardas 1, 2 e a metade "banco" da 3: só ambiente, antes de abrir a API. */
export function checkEnvironmentGuards(
  env: Record<string, string | undefined>,
): GuardFailure[] {
  const failures: GuardFailure[] = [];

  if ((env.TEST_ACCOUNTS_ENABLED ?? '').trim().toLowerCase() !== 'true') {
    failures.push({
      guard: 'TEST_ACCOUNTS_ENABLED',
      message:
        'TEST_ACCOUNTS_ENABLED precisa ser "true" (só o ambiente de homolog a define).',
    });
  }

  const appEnv = (env.APP_ENV ?? '').trim();
  if (!appEnv) {
    failures.push({
      guard: 'APP_ENV',
      message:
        'APP_ENV não definida: o script exige APP_ENV definida e diferente de production.',
    });
  } else if (appEnv.toLowerCase() === 'production') {
    failures.push({
      guard: 'APP_ENV',
      message: 'APP_ENV=production.',
    });
  }

  const databaseName = databaseNameFromUrl(env.DATABASE_URL);
  if (!databaseName) {
    failures.push({
      guard: 'DATABASE_NAME',
      message: 'DATABASE_URL ausente ou sem o nome do banco.',
    });
  } else if (
    PRODUCTION_DATABASE_NAMES.some(
      (name) => name.toLowerCase() === databaseName.toLowerCase(),
    )
  ) {
    failures.push({
      guard: 'DATABASE_NAME',
      message: `o banco do DATABASE_URL se chama "${databaseName}", o nome do banco de produção.`,
    });
  }

  return failures;
}

/** A metade "Asaas" da guarda 3: precisa do banco (system_settings). */
export function checkAsaasGuard(
  config: AsaasEnvironmentState | null | undefined,
): GuardFailure[] {
  if (!config) {
    return [
      {
        guard: 'ASAAS_SANDBOX',
        message: 'configuração do Asaas não encontrada.',
      },
    ];
  }

  if (config.environment !== 'sandbox') {
    return [
      {
        guard: 'ASAAS_SANDBOX',
        message: `o Asaas ativo está em "${config.environment}", não em sandbox.`,
      },
    ];
  }

  // Marcado como sandbox com a URL de produção ainda falaria com o Asaas de
  // verdade: a URL ativa também precisa ser a do sandbox.
  const url = config.sandbox?.url ?? '';
  if (!/sandbox/i.test(url)) {
    return [
      {
        guard: 'ASAAS_SANDBOX',
        message: `o Asaas está marcado como sandbox, mas a URL ativa (${url || 'vazia'}) não é a do sandbox.`,
      },
    ];
  }

  return [];
}

/** Uma linha por guarda que falhou, dizendo qual. */
export function describeGuardFailures(failures: GuardFailure[]): string {
  return [
    'Contas de teste: guarda de ambiente recusou a execução. Nada foi gravado.',
    ...failures.map(
      (failure) =>
        `  - guarda ${GUARD_NUMBER[failure.guard]} (${failure.guard}): ${failure.message}`,
    ),
  ].join('\n');
}

import {
  checkAsaasGuard,
  checkEnvironmentGuards,
  databaseNameFromUrl,
  describeGuardFailures,
} from './guard';

const HOMOLOG_ENV = {
  TEST_ACCOUNTS_ENABLED: 'true',
  APP_ENV: 'development',
  DATABASE_URL:
    'postgresql://postgres:segredo@postgres-dev:5432/atrupeDbDev?schema=public',
};

const SANDBOX = {
  environment: 'sandbox',
  sandbox: { url: 'https://api-sandbox.asaas.com/v3' },
  production: { url: 'https://api.asaas.com/v3' },
};

describe('databaseNameFromUrl', () => {
  it('lê o nome do banco do DATABASE_URL', () => {
    expect(databaseNameFromUrl(HOMOLOG_ENV.DATABASE_URL)).toBe('atrupeDbDev');
    expect(databaseNameFromUrl('postgresql://u:p%40ss@db:5432/atrupeDb')).toBe(
      'atrupeDb',
    );
  });

  it('devolve null sem URL, sem nome ou com URL inválida', () => {
    expect(databaseNameFromUrl(undefined)).toBeNull();
    expect(databaseNameFromUrl('   ')).toBeNull();
    expect(databaseNameFromUrl('postgresql://u:p@db:5432/')).toBeNull();
    expect(databaseNameFromUrl('não é uma url')).toBeNull();
  });
});

describe('checkEnvironmentGuards', () => {
  it('libera o ambiente de homolog', () => {
    expect(checkEnvironmentGuards(HOMOLOG_ENV)).toEqual([]);
  });

  it('exige TEST_ACCOUNTS_ENABLED=true', () => {
    for (const value of [undefined, '', 'false', '1', 'yes']) {
      const failures = checkEnvironmentGuards({
        ...HOMOLOG_ENV,
        TEST_ACCOUNTS_ENABLED: value,
      });
      expect(failures.map((f) => f.guard)).toEqual(['TEST_ACCOUNTS_ENABLED']);
    }
    expect(
      checkEnvironmentGuards({
        ...HOMOLOG_ENV,
        TEST_ACCOUNTS_ENABLED: ' TRUE ',
      }),
    ).toEqual([]);
  });

  it('recusa APP_ENV production, em qualquer caixa, e APP_ENV ausente', () => {
    for (const value of [
      'production',
      'Production',
      ' PRODUCTION ',
      '',
      undefined,
    ]) {
      const failures = checkEnvironmentGuards({
        ...HOMOLOG_ENV,
        APP_ENV: value,
      });
      expect(failures.map((f) => f.guard)).toEqual(['APP_ENV']);
    }
  });

  it('recusa o banco com o nome do de produção, ignorando maiúsculas', () => {
    for (const name of ['atrupeDb', 'atrupedb', 'ATRUPEDB']) {
      const failures = checkEnvironmentGuards({
        ...HOMOLOG_ENV,
        DATABASE_URL: `postgresql://u:p@db:5432/${name}?schema=public`,
      });
      expect(failures).toEqual([
        expect.objectContaining({
          guard: 'DATABASE_NAME',
          message: expect.stringContaining(name),
        }),
      ]);
    }
  });

  it('recusa DATABASE_URL ausente', () => {
    const failures = checkEnvironmentGuards({
      ...HOMOLOG_ENV,
      DATABASE_URL: undefined,
    });
    expect(failures.map((f) => f.guard)).toEqual(['DATABASE_NAME']);
  });

  it('em produção, aponta todas as guardas que falharam', () => {
    const failures = checkEnvironmentGuards({
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/atrupeDb?schema=public',
    });
    expect(failures.map((f) => f.guard)).toEqual([
      'TEST_ACCOUNTS_ENABLED',
      'APP_ENV',
      'DATABASE_NAME',
    ]);
  });
});

describe('checkAsaasGuard', () => {
  it('libera o sandbox', () => {
    expect(checkAsaasGuard(SANDBOX)).toEqual([]);
  });

  it('recusa o Asaas de produção', () => {
    const failures = checkAsaasGuard({ ...SANDBOX, environment: 'production' });
    expect(failures).toEqual([
      expect.objectContaining({
        guard: 'ASAAS_SANDBOX',
        message: expect.stringContaining('production'),
      }),
    ]);
  });

  it('recusa sandbox apontando para a URL de produção', () => {
    const failures = checkAsaasGuard({
      ...SANDBOX,
      sandbox: { url: 'https://api.asaas.com/v3' },
    });
    expect(failures.map((f) => f.guard)).toEqual(['ASAAS_SANDBOX']);
  });

  it('recusa configuração ausente', () => {
    expect(checkAsaasGuard(null).map((f) => f.guard)).toEqual([
      'ASAAS_SANDBOX',
    ]);
  });
});

describe('describeGuardFailures', () => {
  it('diz qual guarda falhou e que nada foi gravado', () => {
    const text = describeGuardFailures([
      { guard: 'TEST_ACCOUNTS_ENABLED', message: 'falta a variável.' },
      { guard: 'ASAAS_SANDBOX', message: 'Asaas em produção.' },
    ]);
    expect(text).toContain('Nada foi gravado');
    expect(text).toContain(
      'guarda 1 (TEST_ACCOUNTS_ENABLED): falta a variável.',
    );
    expect(text).toContain('guarda 3 (ASAAS_SANDBOX): Asaas em produção.');
  });
});

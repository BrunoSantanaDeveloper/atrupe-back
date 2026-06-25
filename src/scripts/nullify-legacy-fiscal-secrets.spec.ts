import * as crypto from 'crypto';
import { loadKeyring, encrypt } from './fiscal-secret-crypto';
import { runNullify } from './nullify-legacy-fiscal-secrets';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestKeyring() {
  const hexKey = crypto.randomBytes(32).toString('hex');
  process.env.DATABASE_ENCRYPTION_KEYRING = JSON.stringify({
    'test-key': hexKey,
  });
  process.env.DATABASE_ENCRYPTION_ACTIVE_KEY_ID = 'test-key';
  return loadKeyring();
}

function setEnvVars(opts: { useEncrypted?: string; writeMode?: string } = {}) {
  process.env.USE_ENCRYPTED_FISCAL_DB = opts.useEncrypted ?? 'true';
  process.env.FISCAL_DB_WRITE_MODE = opts.writeMode ?? 'ENCRYPTED_ONLY';
}

function buildPrisma(overrides: Record<string, any> = {}) {
  return {
    fiscalSecretMigrationState: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ version: 1, status: 'COMPLETED' }),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    invoicyConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    digitalCertificate: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    companyEnvironmentCredential: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoicyEnvironmentConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as any;
}

// ── Pré-condições de env vars ─────────────────────────────────────────────────

describe('runNullify — pré-condições de env vars', () => {
  beforeEach(() => {
    makeTestKeyring();
    jest.clearAllMocks();
  });

  test('aborta se USE_ENCRYPTED_FISCAL_DB !== "true"', async () => {
    setEnvVars({ useEncrypted: 'false', writeMode: 'ENCRYPTED_ONLY' });
    const prisma = buildPrisma();
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /USE_ENCRYPTED_FISCAL_DB/,
    );
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  test('aborta se FISCAL_DB_WRITE_MODE !== "ENCRYPTED_ONLY"', async () => {
    setEnvVars({ useEncrypted: 'true', writeMode: 'DUAL' });
    const prisma = buildPrisma();
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /FISCAL_DB_WRITE_MODE/,
    );
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });
});

// ── Pré-condição: migração concluída ─────────────────────────────────────────

describe('runNullify — pré-condição de migração', () => {
  beforeEach(() => {
    makeTestKeyring();
    setEnvVars();
    jest.clearAllMocks();
  });

  test('aborta se status = PENDING', async () => {
    const prisma = buildPrisma({
      fiscalSecretMigrationState: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ version: 1, status: 'PENDING' }),
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /PENDING/,
    );
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  test('aborta se status = FAILED', async () => {
    const prisma = buildPrisma({
      fiscalSecretMigrationState: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ version: 1, status: 'FAILED' }),
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /FAILED/,
    );
  });

  test('aborta se estado não existe', async () => {
    const prisma = buildPrisma({
      fiscalSecretMigrationState: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /nao encontrado/,
    );
  });
});

// ── Reconciliação anti-join ───────────────────────────────────────────────────

describe('runNullify — reconciliação anti-join', () => {
  beforeEach(() => {
    makeTestKeyring();
    setEnvVars();
    jest.clearAllMocks();
  });

  test('aborta se empresa tem accessKey sem CompanyEnvironmentCredential cifrado', async () => {
    const prisma = buildPrisma({
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
        updateMany: jest.fn(),
      },
      companyEnvironmentCredential: {
        findMany: jest.fn().mockResolvedValue([]), // nenhuma credencial cifrada
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /sem nenhum CompanyEnvironmentCredential/,
    );
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  test('aborta se envelope de accessKey não é descriptografável', async () => {
    const kr = loadKeyring();
    // Envelope cifrado com chave diferente
    const outroHex = crypto.randomBytes(32).toString('hex');
    process.env.DATABASE_ENCRYPTION_KEYRING = JSON.stringify({
      'outra-key': outroHex,
    });
    process.env.DATABASE_ENCRYPTION_ACTIVE_KEY_ID = 'outra-key';
    const outraKr = loadKeyring();

    const envelopeInvalido = encrypt(
      'valor',
      {
        table: 'company_environment_credentials',
        recordId: 'cred-id',
        companyId: 'c1',
        field: 'providerAccessKeyEncrypted',
        scope: 'PRODUCAO',
      },
      outraKr,
    );

    // Restaura keyring original
    process.env.DATABASE_ENCRYPTION_KEYRING = JSON.stringify({
      'test-key': [...kr.keyring.values()][0].toString('hex'),
    });
    process.env.DATABASE_ENCRYPTION_ACTIVE_KEY_ID = 'test-key';

    const prisma = buildPrisma({
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
        updateMany: jest.fn(),
      },
      companyEnvironmentCredential: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cred-id',
            companyId: 'c1',
            environment: 'PRODUCAO',
            providerAccessKeyEncrypted: envelopeInvalido,
          },
        ]),
      },
    });

    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /descriptografavel com o keyring atual/,
    );
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  test('aborta se InvoicyConfig tem cscToken sem InvoicyEnvironmentConfig cifrado', async () => {
    const prisma = buildPrisma({
      invoicyConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ic1',
            companyId: 'c1',
            activeEnvironment: 'PRODUCAO',
            environment: 'PRODUCAO',
            ambiente: 1,
          },
        ]),
        updateMany: jest.fn(),
      },
      invoicyEnvironmentConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // sem config ambiental
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /sem InvoicyEnvironmentConfig cifrado/,
    );
    expect(prisma.invoicyConfig.updateMany).not.toHaveBeenCalled();
  });

  test('aborta se DigitalCertificate tem certificate sem certificateEncrypted', async () => {
    const prisma = buildPrisma({
      digitalCertificate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cert1',
            companyId: 'c1',
            certificateEncrypted: null,
            passwordEncrypted: null,
          },
        ]),
        updateMany: jest.fn(),
      },
    });
    await expect(runNullify(prisma, loadKeyring(), false)).rejects.toThrow(
      /sem certificateEncrypted/,
    );
    expect(prisma.digitalCertificate.updateMany).not.toHaveBeenCalled();
  });
});

// ── Caminho feliz ─────────────────────────────────────────────────────────────

describe('runNullify — caminho feliz (todas as pré-condições satisfeitas)', () => {
  beforeEach(() => {
    makeTestKeyring();
    setEnvVars();
    jest.clearAllMocks();
  });

  test('executa updateMany corretos com pré-condições satisfeitas', async () => {
    const kr = loadKeyring();

    const credEnvelope = encrypt(
      'chave-acesso',
      {
        table: 'company_environment_credentials',
        recordId: 'cred-id-1',
        companyId: 'company-1',
        field: 'providerAccessKeyEncrypted',
        scope: 'PRODUCAO',
      },
      kr,
    );

    const certEnvelope = encrypt(
      'cert-pem-data',
      {
        table: 'digital_certificates',
        recordId: 'cert-id-1',
        companyId: 'company-1',
        field: 'certificateEncrypted',
        scope: 'GLOBAL',
      },
      kr,
    );

    const cscEnvelope = encrypt(
      'csc-token-value',
      {
        table: 'invoicy_environment_configs',
        recordId: 'env-config-id-1',
        companyId: 'company-1',
        field: 'cscTokenEncrypted',
        scope: 'PRODUCAO',
      },
      kr,
    );

    const prisma = buildPrisma({
      company: {
        findMany: jest.fn().mockResolvedValue([{ id: 'company-1' }]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companyEnvironmentCredential: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cred-id-1',
            companyId: 'company-1',
            environment: 'PRODUCAO',
            providerAccessKeyEncrypted: credEnvelope,
          },
        ]),
      },
      invoicyConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ic-1',
            companyId: 'company-1',
            activeEnvironment: 'PRODUCAO',
            environment: 'PRODUCAO',
            ambiente: 1,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoicyEnvironmentConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'env-config-id-1',
          invoicyConfigId: 'ic-1',
          environment: 'PRODUCAO',
          cscTokenEncrypted: cscEnvelope,
        }),
      },
      digitalCertificate: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cert-id-1',
            companyId: 'company-1',
            certificateEncrypted: certEnvelope,
            passwordEncrypted: certEnvelope,
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await runNullify(prisma, kr, false);

    expect(prisma.company.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { accessKey: null } }),
    );
    expect(prisma.invoicyConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cscToken: null } }),
    );
    expect(prisma.digitalCertificate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { certificate: null, password: null } }),
    );
  });

  test('dry-run não chama updateMany', async () => {
    const prisma = buildPrisma({
      company: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(),
      },
      invoicyConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(),
      },
      digitalCertificate: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn(),
      },
    });

    await runNullify(prisma, loadKeyring(), true);

    expect(prisma.company.updateMany).not.toHaveBeenCalled();
    expect(prisma.invoicyConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.digitalCertificate.updateMany).not.toHaveBeenCalled();
  });
});

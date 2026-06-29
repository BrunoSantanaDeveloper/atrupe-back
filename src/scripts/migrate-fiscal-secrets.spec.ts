import * as crypto from 'crypto';
import {
  generateAAD,
  encrypt,
  decrypt,
  loadKeyring,
  deriveEnvironment,
} from './fiscal-secret-crypto';
import { runMigration } from './migrate-fiscal-secrets';

// ── Helpers de teste ──────────────────────────────────────────────────────────

function makeTestKeyring() {
  const hexKey = crypto.randomBytes(32).toString('hex');
  process.env.DATABASE_ENCRYPTION_KEYRING = JSON.stringify({
    'test-key': hexKey,
  });
  process.env.DATABASE_ENCRYPTION_ACTIVE_KEY_ID = 'test-key';
  return loadKeyring();
}

function makePrisma(
  overrides: Partial<ReturnType<typeof buildDefaultPrisma>> = {},
) {
  return { ...buildDefaultPrisma(), ...overrides } as any;
}

function buildDefaultPrisma() {
  return {
    fiscalSecretMigrationState: {
      upsert: jest
        .fn()
        .mockResolvedValue({ version: 1, status: 'RUNNING', cursors: {} }),
      update: jest.fn().mockResolvedValue({}),
    },
    company: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoicyConfig: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    digitalCertificate: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    companyEnvironmentCredential: {
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    invoicyEnvironmentConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

// ── fiscal-secret-crypto ──────────────────────────────────────────────────────

describe('fiscal-secret-crypto', () => {
  const aadParams = {
    table: 'company_environment_credentials',
    recordId: 'rec-id-123',
    companyId: 'company-id-456',
    field: 'providerAccessKeyEncrypted',
    scope: 'PRODUCAO' as const,
  };

  test('encrypt produz envelope enc:v1 com 6 segmentos', () => {
    const kr = makeTestKeyring();
    const envelope = encrypt('secret-value', aadParams, kr);
    expect(envelope).toMatch(/^enc:v1:/);
    expect(envelope.split(':').length).toBe(6);
  });

  test('decrypt(encrypt()) retorna o plaintext original', () => {
    const kr = makeTestKeyring();
    const plaintext = 'access-key-valor-teste';
    const envelope = encrypt(plaintext, aadParams, kr);
    expect(decrypt(envelope, aadParams, kr)).toBe(plaintext);
  });

  test('decrypt falha se AAD diferente (table errado)', () => {
    const kr = makeTestKeyring();
    const envelope = encrypt('valor', aadParams, kr);
    expect(() =>
      decrypt(envelope, { ...aadParams, table: 'outra_tabela' }, kr),
    ).toThrow();
  });

  test('generateAAD bate exatamente com formato EncryptionService', () => {
    const params = {
      table: 'digital_certificates',
      recordId: 'id-cert',
      companyId: 'id-empresa',
      field: 'certificateEncrypted',
      scope: 'GLOBAL' as const,
    };
    const aad = generateAAD(params);
    // Replica a lógica de EncryptionService.generateAAD manualmente
    const expected = [
      'v1',
      `${Buffer.byteLength('digital_certificates', 'utf8')}`,
      'digital_certificates',
      `${Buffer.byteLength('id-cert', 'utf8')}`,
      'id-cert',
      `${Buffer.byteLength('id-empresa', 'utf8')}`,
      'id-empresa',
      `${Buffer.byteLength('certificateEncrypted', 'utf8')}`,
      'certificateEncrypted',
      `${Buffer.byteLength('GLOBAL', 'utf8')}`,
      'GLOBAL',
    ].join(':');
    expect(aad.toString('utf8')).toBe(expected);
  });

  test('AAD usa os nomes exatos dos campos das tabelas cifradas', () => {
    const fields = [
      {
        table: 'company_environment_credentials',
        field: 'providerAccessKeyEncrypted',
      },
      { table: 'invoicy_environment_configs', field: 'cscTokenEncrypted' },
      { table: 'digital_certificates', field: 'certificateEncrypted' },
      { table: 'digital_certificates', field: 'passwordEncrypted' },
    ];
    for (const { table, field } of fields) {
      const aad = generateAAD({
        table,
        recordId: 'r',
        companyId: 'c',
        field,
        scope: 'GLOBAL',
      });
      expect(aad.toString()).toContain(field);
      expect(aad.toString()).toContain(table);
    }
  });

  test('deriveEnvironment: activeEnvironment tem prioridade', () => {
    expect(
      deriveEnvironment({
        activeEnvironment: 'PRODUCAO',
        environment: 'HOMOLOGACAO',
        ambiente: 2,
      }),
    ).toBe('PRODUCAO');
  });

  test('deriveEnvironment: environment=PRODUCAO quando activeEnvironment ausente', () => {
    expect(
      deriveEnvironment({
        activeEnvironment: null,
        environment: 'PRODUCAO',
        ambiente: 2,
      }),
    ).toBe('PRODUCAO');
  });

  test('deriveEnvironment: ambiente=1 mapeia para PRODUCAO', () => {
    expect(
      deriveEnvironment({
        activeEnvironment: null,
        environment: 'HOMOLOGACAO',
        ambiente: 1,
      }),
    ).toBe('PRODUCAO');
  });

  test('deriveEnvironment: padrão é HOMOLOGACAO', () => {
    expect(
      deriveEnvironment({
        activeEnvironment: null,
        environment: 'HOMOLOGACAO',
        ambiente: 2,
      }),
    ).toBe('HOMOLOGACAO');
  });
});

// ── runMigration ─────────────────────────────────────────────────────────────

describe('runMigration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna sem escrever quando status já é COMPLETED', async () => {
    const kr = makeTestKeyring();
    const prisma = makePrisma({
      fiscalSecretMigrationState: {
        upsert: jest
          .fn()
          .mockResolvedValue({ version: 1, status: 'COMPLETED', cursors: {} }),
        update: jest.fn(),
      },
    });

    await runMigration(prisma, kr, false);

    expect(prisma.company.findMany).not.toHaveBeenCalled();
    expect(prisma.fiscalSecretMigrationState.update).not.toHaveBeenCalled();
  });

  test('atualiza status para COMPLETED no caminho feliz (sem registros)', async () => {
    const kr = makeTestKeyring();
    const prisma = makePrisma();

    await runMigration(prisma, kr, false);

    expect(prisma.fiscalSecretMigrationState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: 1 },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  test('pula Company com accessKey mas sem emissores (dado orfao)', async () => {
    const kr = makeTestKeyring();
    const prisma = makePrisma({
      company: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'c1', accessKey: 'ak1', createdAt: new Date() },
          ])
          .mockResolvedValue([]),
      },
      invoicyConfig: {
        count: jest.fn().mockResolvedValue(0),
        // Nenhum emissor para c1 → empresa eh pulada com aviso
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await runMigration(prisma, kr, false);

    expect(prisma.companyEnvironmentCredential.upsert).not.toHaveBeenCalled();
    expect(prisma.fiscalSecretMigrationState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  test('migra Company.accessKey apenas para o ambiente operacional legado derivado', async () => {
    const kr = makeTestKeyring();
    const credId = 'cred-uuid-001';

    const prisma = makePrisma({
      company: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'company-1',
              accessKey: 'chave-acesso',
              createdAt: new Date(),
            },
          ])
          .mockResolvedValue([]),
      },
      invoicyConfig: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest
          .fn()
          // Bloco 1: emissores da empresa (para derivar ambiente)
          .mockResolvedValueOnce([
            {
              activeEnvironment: 'PRODUCAO',
              environment: 'PRODUCAO',
              ambiente: 1,
            },
          ])
          // Bloco 2: configs com cscToken
          .mockResolvedValue([]),
      },
      companyEnvironmentCredential: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: credId, providerAccessKeyEncrypted: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await runMigration(prisma, kr, false);

    // Deve upsert apenas para PRODUCAO (não HOMOLOGACAO)
    expect(prisma.companyEnvironmentCredential.upsert).toHaveBeenCalledTimes(1);
    const upsertCall =
      prisma.companyEnvironmentCredential.upsert.mock.calls[0][0];
    expect(upsertCall.where.companyId_environment.environment).toBe('PRODUCAO');

    // Deve update com envelope cifrado
    expect(prisma.companyEnvironmentCredential.update).toHaveBeenCalledTimes(1);
    const updateCall =
      prisma.companyEnvironmentCredential.update.mock.calls[0][0];
    expect(updateCall.data.providerAccessKeyEncrypted).toMatch(/^enc:v1:/);
  });

  test('pula CompanyEnvironmentCredential já cifrado (idempotência)', async () => {
    const kr = makeTestKeyring();
    const existingEnvelope = encrypt(
      'chave-antiga',
      {
        table: 'company_environment_credentials',
        recordId: 'cred-id-existente',
        companyId: 'company-2',
        field: 'providerAccessKeyEncrypted',
        scope: 'HOMOLOGACAO',
      },
      kr,
    );

    const prisma = makePrisma({
      company: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'company-2', accessKey: 'nova-chave', createdAt: new Date() },
          ])
          .mockResolvedValue([]),
      },
      invoicyConfig: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              activeEnvironment: 'HOMOLOGACAO',
              environment: 'HOMOLOGACAO',
              ambiente: 2,
            },
          ])
          .mockResolvedValue([]),
      },
      companyEnvironmentCredential: {
        upsert: jest.fn().mockResolvedValue({
          id: 'cred-id-existente',
          providerAccessKeyEncrypted: existingEnvelope,
        }),
        update: jest.fn(),
      },
    });

    await runMigration(prisma, kr, false);

    // Não deve atualizar pois já está cifrado
    expect(prisma.companyEnvironmentCredential.update).not.toHaveBeenCalled();
  });

  test('atualiza status para FAILED e sanitiza mensagem em caso de erro', async () => {
    const kr = makeTestKeyring();
    // Simula mensagem de erro com valor que parece chave/token (20+ chars hex/base64)
    const fakeSecret = 'abcdef1234567890abcdef1234567890';
    const prisma = makePrisma({
      company: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockRejectedValue(
            new Error(`Conexão perdida com segredo=${fakeSecret}`),
          ),
      },
    });

    await expect(runMigration(prisma, kr, false)).rejects.toThrow();

    expect(prisma.fiscalSecretMigrationState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );

    const updateData =
      prisma.fiscalSecretMigrationState.update.mock.calls[0][0].data;
    expect(updateData.errorSanitized).toBeDefined();
    // O regex `[A-Za-z0-9+/=]{20,}` deve ter redactado o valor do segredo (32 hex chars)
    expect(updateData.errorSanitized).not.toContain(fakeSecret);
  });

  test('dry-run não chama upsert/update de dados mesmo com registros', async () => {
    const kr = makeTestKeyring();
    const prisma = makePrisma({
      company: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 'company-3', accessKey: 'chave', createdAt: new Date() },
          ])
          .mockResolvedValue([]),
      },
      invoicyConfig: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              activeEnvironment: 'PRODUCAO',
              environment: 'PRODUCAO',
              ambiente: 1,
            },
          ])
          .mockResolvedValue([]),
      },
    });

    await runMigration(prisma, kr, true);

    expect(prisma.fiscalSecretMigrationState.upsert).not.toHaveBeenCalled();
    expect(prisma.companyEnvironmentCredential.upsert).not.toHaveBeenCalled();
    expect(prisma.fiscalSecretMigrationState.update).not.toHaveBeenCalled();
  });
});

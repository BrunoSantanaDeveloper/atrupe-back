import {
  normalizePermissions,
  runNormalize,
} from './normalize-other-sellers-permission';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeRole = { id: string; name: string; permissions: string[] };

/**
 * Prisma falso que mantém os cargos em memória, para que o `findMany` de
 * verificação no fim de `runNormalize` enxergue o resultado dos updates.
 */
function buildPrisma(roles: FakeRole[]) {
  const store = roles.map((r) => ({ ...r, permissions: [...r.permissions] }));

  const findMany = jest.fn(async ({ where }: any) => {
    const wanted: string[] = where.OR.map((o: any) => o.permissions.has);
    return store
      .filter((role) => role.permissions.some((p) => wanted.includes(p)))
      .map((role) => ({ ...role, permissions: [...role.permissions] }));
  });

  const update = jest.fn(async ({ where, data }: any) => {
    const role = store.find((r) => r.id === where.id);
    if (!role) throw new Error(`role ${where.id} não encontrado`);
    role.permissions = data.permissions;
    return role;
  });

  return {
    prisma: {
      role: { findMany, update },
      // As chamadas já foram resolvidas por `update`; só aguardamos as promises.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as any,
    store,
    findMany,
    update,
  };
}

// ── normalizePermissions ──────────────────────────────────────────────────────

describe('normalizePermissions', () => {
  it('converte a chave legada preservando a ação', () => {
    expect(
      normalizePermissions([
        'sale:other_sellers:view',
        'sale:other_sellers:edit',
      ]),
    ).toEqual(['sale:other_quotation:view', 'sale:other_quotation:edit']);
  });

  it('não altera permissões de outros recursos', () => {
    const input = ['sale:quotation:view', 'financial:flow:edit'];
    expect(normalizePermissions(input)).toEqual(input);
  });

  it('preserva a ordem original das permissões', () => {
    expect(
      normalizePermissions([
        'sale:quotation:view',
        'sale:other_sellers:view',
        'financial:flow:edit',
      ]),
    ).toEqual([
      'sale:quotation:view',
      'sale:other_quotation:view',
      'financial:flow:edit',
    ]);
  });

  it('deduplica quando o cargo já tem as duas chaves', () => {
    expect(
      normalizePermissions([
        'sale:other_quotation:view',
        'sale:other_sellers:view',
      ]),
    ).toEqual(['sale:other_quotation:view']);
  });

  it('é idempotente', () => {
    const once = normalizePermissions(['sale:other_sellers:view']);
    expect(normalizePermissions(once)).toEqual(once);
  });

  it('não confunde recursos com prefixo parecido', () => {
    const input = ['sale:other_sellers_report:view'];
    expect(normalizePermissions(input)).toEqual(input);
  });

  it('lida com array vazio', () => {
    expect(normalizePermissions([])).toEqual([]);
  });
});

// ── runNormalize ──────────────────────────────────────────────────────────────

describe('runNormalize', () => {
  it('não escreve nada em dry-run', async () => {
    const { prisma, store, update } = buildPrisma([
      { id: 'r1', name: 'Vendedor', permissions: ['sale:other_sellers:view'] },
    ]);

    const result = await runNormalize(prisma, true);

    expect(result).toEqual({ affected: 1, updated: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(store[0].permissions).toEqual(['sale:other_sellers:view']);
  });

  it('converte os cargos afetados quando aplicado', async () => {
    const { prisma, store } = buildPrisma([
      {
        id: 'r1',
        name: 'Gerente',
        permissions: ['sale:quotation:view', 'sale:other_sellers:edit'],
      },
      { id: 'r2', name: 'Vendedor', permissions: ['sale:other_sellers:view'] },
    ]);

    const result = await runNormalize(prisma, false);

    expect(result).toEqual({ affected: 2, updated: 2 });
    expect(store[0].permissions).toEqual([
      'sale:quotation:view',
      'sale:other_quotation:edit',
    ]);
    expect(store[1].permissions).toEqual(['sale:other_quotation:view']);
  });

  it('ignora cargos que já usam apenas a chave canônica', async () => {
    const { prisma, update } = buildPrisma([
      { id: 'r1', name: 'Gerente', permissions: ['sale:other_quotation:view'] },
    ]);

    const result = await runNormalize(prisma, false);

    expect(result).toEqual({ affected: 0, updated: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it('é idempotente numa segunda execução', async () => {
    const { prisma, store } = buildPrisma([
      { id: 'r1', name: 'Vendedor', permissions: ['sale:other_sellers:view'] },
    ]);

    await runNormalize(prisma, false);
    const second = await runNormalize(prisma, false);

    expect(second).toEqual({ affected: 0, updated: 0 });
    expect(store[0].permissions).toEqual(['sale:other_quotation:view']);
  });

  it('falha se sobrar algum cargo legado após a atualização', async () => {
    const { prisma, update } = buildPrisma([
      { id: 'r1', name: 'Vendedor', permissions: ['sale:other_sellers:view'] },
    ]);
    // Simula um update que não persiste (ex.: escrita concorrente).
    update.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      name: 'Vendedor',
      permissions: ['sale:other_sellers:view'],
    }));

    await expect(runNormalize(prisma, false)).rejects.toThrow(
      /Ainda restam 1 cargo\(s\) com a chave legada/,
    );
  });
});

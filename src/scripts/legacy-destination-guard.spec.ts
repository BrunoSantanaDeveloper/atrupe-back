import {
  assertSingleDestination,
  findDestinationConflict,
} from './legacy-destination-guard';

describe('findDestinationConflict', () => {
  const piloto = { id: 'empresa-1', name: 'Cliente Piloto' };
  const outra = { id: 'empresa-2', name: 'Outra Conta' };
  const base = 'acn_000001';

  const conflito = (sameCnpj: any[], loads: any[] = []) =>
    findDestinationConflict({ base, sameCnpj, loads });

  it('libera quando há uma conta e nenhuma carga anterior', () => {
    expect(conflito([piloto])).toBeNull();
  });

  it('libera recarga da mesma base na mesma conta, ainda que repetida', () => {
    expect(
      conflito(
        [piloto],
        [
          { base, company: piloto },
          { base, company: piloto },
        ],
      ),
    ).toBeNull();
  });

  it('bloqueia com mais de uma conta no CNPJ e nomeia todas', () => {
    const motivo = conflito([piloto, outra]);

    expect(motivo).toMatch(/2 contas/);
    expect(motivo).toContain('Cliente Piloto (empresa-1)');
    expect(motivo).toContain('Outra Conta (empresa-2)');
  });

  it('bloqueia base já carregada em outra conta, citando-a uma vez só', () => {
    const motivo = conflito(
      [piloto],
      [
        { base, company: outra },
        { base, company: outra },
        { base, company: piloto },
      ],
    );

    expect(motivo).toMatch(/já foi migrada para Outra Conta \(empresa-2\)\./);
  });

  it('bloqueia carga anterior mesmo sem conta atual com o CNPJ', () => {
    // A conta que recebeu os dados teve o CNPJ trocado depois.
    expect(conflito([], [{ base, company: outra }])).toMatch(/já foi migrada/);
  });

  it('bloqueia conta que já recebeu outra base do legado', () => {
    // As bases numeram os registros a partir do 1: o cliente 5 desta base
    // seria confundido com o cliente 5 da anterior.
    const motivo = conflito(
      [piloto],
      [{ base: 'acn_000002', company: piloto }],
    );

    expect(motivo).toMatch(/já recebeu a base acn_000002/);
  });

  it('não confunde a carga de outra base em outra conta', () => {
    expect(
      conflito([piloto], [{ base: 'acn_000002', company: outra }]),
    ).toBeNull();
  });

  it('sinaliza conta inativa', () => {
    expect(conflito([piloto, { ...outra, isActive: false }])).toContain(
      'Outra Conta (empresa-2) — inativa',
    );
  });
});

describe('assertSingleDestination', () => {
  const prisma = (companies: any[], runs: any[] = []) =>
    ({
      company: { findMany: jest.fn().mockResolvedValue(companies) },
      migrationRun: {
        findMany: jest.fn().mockResolvedValue(
          runs.map(({ base, company }) => ({
            legacyBase: base,
            company,
          })),
        ),
      },
    }) as any;

  it('compara só os dígitos do CNPJ', async () => {
    const db = prisma([
      { id: 'a', name: 'A', cnpj: '11.222.333/0001-81' },
      { id: 'b', name: 'B', cnpj: '11222333000181' },
      { id: 'c', name: 'C', cnpj: '99888777000166' },
    ]);

    await expect(
      assertSingleDestination(db, 'acn_000001', '11222333000181'),
    ).rejects.toThrow(/2 contas: A \(a\), B \(b\)/);
  });

  it('busca cargas reais da base e das contas com o CNPJ', async () => {
    const db = prisma([{ id: 'a', name: 'A', cnpj: '11222333000181' }]);

    await assertSingleDestination(db, 'acn_000001', '11.222.333/0001-81');

    expect(db.migrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          dryRun: false,
          startedAt: { not: null },
          OR: [
            { legacyBase: { in: ['acn_000001'] } },
            { companyId: { in: ['a'] } },
          ],
        },
      }),
    );
  });

  it('recusa quando a conta já recebeu outra base', async () => {
    const conta = { id: 'a', name: 'A' };
    const db = prisma(
      [{ ...conta, cnpj: '11222333000181' }],
      [{ base: 'acn_000009', company: conta }],
    );

    await expect(
      assertSingleDestination(db, 'acn_000001', '11222333000181'),
    ).rejects.toThrow(/já recebeu a base acn_000009/);
  });
});

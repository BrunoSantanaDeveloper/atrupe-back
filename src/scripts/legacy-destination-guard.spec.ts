import {
  assertSingleDestination,
  findDestinationConflict,
} from './legacy-destination-guard';

describe('findDestinationConflict', () => {
  const piloto = { id: 'empresa-1', name: 'Cliente Piloto' };
  const outra = { id: 'empresa-2', name: 'Outra Conta' };

  it('libera quando há uma conta e nenhuma carga anterior', () => {
    expect(findDestinationConflict([piloto], [])).toBeNull();
  });

  it('libera recarga na mesma conta, ainda que repetida', () => {
    expect(findDestinationConflict([piloto], [piloto, piloto])).toBeNull();
  });

  it('bloqueia com mais de uma conta no CNPJ e nomeia todas', () => {
    const motivo = findDestinationConflict([piloto, outra], []);

    expect(motivo).toMatch(/2 contas/);
    expect(motivo).toContain('Cliente Piloto (empresa-1)');
    expect(motivo).toContain('Outra Conta (empresa-2)');
  });

  it('bloqueia carga já feita em outra conta, citando-a uma vez só', () => {
    const motivo = findDestinationConflict([piloto], [outra, outra, piloto]);

    expect(motivo).toMatch(/já foi migrada para Outra Conta \(empresa-2\)\./);
  });

  it('bloqueia carga anterior mesmo sem conta atual com o CNPJ', () => {
    // A conta que recebeu os dados teve o CNPJ trocado depois.
    expect(findDestinationConflict([], [outra])).toMatch(/já foi migrada/);
  });

  it('sinaliza conta inativa', () => {
    expect(
      findDestinationConflict([piloto, { ...outra, isActive: false }], []),
    ).toContain('Outra Conta (empresa-2) — inativa');
  });
});

describe('assertSingleDestination', () => {
  const prisma = (companies: any[], runs: any[] = []) =>
    ({
      company: { findMany: jest.fn().mockResolvedValue(companies) },
      migrationRun: {
        findMany: jest
          .fn()
          .mockResolvedValue(runs.map((company) => ({ company }))),
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

  it('considera só cargas reais que chegaram a começar', async () => {
    const db = prisma([{ id: 'a', name: 'A', cnpj: '11222333000181' }]);

    await assertSingleDestination(db, 'acn_000001', '11.222.333/0001-81');

    expect(db.migrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          legacyBase: 'acn_000001',
          dryRun: false,
          startedAt: { not: null },
        },
      }),
    );
  });
});

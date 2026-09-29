import { duplicatesToRemove } from './dedupe-imported-financial';

/**
 * A carga do financeiro recriava tudo a cada execução: a busca por duplicata
 * procurava a parcela à meia-noite e a gravação passou a usar o meio-dia. Este
 * script limpa o que sobrou, e não pode levar junto lançamento legítimo.
 */
describe('duplicatesToRemove', () => {
  const dia = (iso: string) => new Date(iso);

  const registro = (over: any = {}) => ({
    id: 'r1',
    description: 'PM [8545]',
    totalAmount: 7778,
    referenceDate: dia('2026-09-08T12:00:00.000Z'),
    createdAt: dia('2026-09-08T12:00:00.000Z'),
    ...over,
  });

  it('mantém o registro mais antigo e devolve os outros', () => {
    const remover = duplicatesToRemove([
      registro({ id: 'r1', createdAt: dia('2026-09-28T18:32:00.000Z') }),
      registro({ id: 'r2', createdAt: dia('2026-09-28T20:04:00.000Z') }),
      registro({ id: 'r3', createdAt: dia('2026-09-29T18:24:00.000Z') }),
    ]);

    expect(remover).toEqual(['r2', 'r3']);
  });

  it('não junta lançamentos de descrição, valor ou data diferentes', () => {
    expect(
      duplicatesToRemove([
        registro({ id: 'r1' }),
        registro({ id: 'r2', description: 'OUTRO [8546]' }),
        registro({ id: 'r3', totalAmount: 96450 }),
        registro({ id: 'r4', referenceDate: dia('2026-09-09T12:00:00.000Z') }),
      ]),
    ).toEqual([]);
  });

  it('desempata pelo id quando a data de criação é a mesma', () => {
    const remover = duplicatesToRemove([
      registro({ id: 'b' }),
      registro({ id: 'a' }),
    ]);

    expect(remover).toEqual(['b']);
  });

  it('trata lançamento sem data de referência', () => {
    const remover = duplicatesToRemove([
      registro({ id: 'r1', referenceDate: null }),
      registro({ id: 'r2', referenceDate: null }),
    ]);

    expect(remover).toEqual(['r2']);
  });
});

import { noteToWrite, readLegacyNotes } from './backfill-legacy-sale-notes';

/**
 * Os recados que saem no orçamento impresso ficam na observação das linhas de
 * pagamento e entrega do legado, que a carga antiga não lia.
 */
describe('noteToWrite', () => {
  it('escreve quando o campo está vazio', () => {
    expect(noteToWrite(null, 'R$ 302 Thiago')).toBe('R$ 302 Thiago');
    expect(noteToWrite('   ', 'R$ 302 Thiago')).toBe('R$ 302 Thiago');
  });

  it('não sobrescreve o que já está escrito', () => {
    // Pode ter sido ajustado no Atrupe depois da migração.
    expect(noteToWrite('combinado com o cliente', 'R$ 302 Thiago')).toBeNull();
  });

  it('ignora observação vazia no legado', () => {
    expect(noteToWrite(null, '   ')).toBeNull();
  });
});

describe('readLegacyNotes', () => {
  it('separa a observação de pagamento da de entrega por venda', async () => {
    const legacy = {
      query: jest.fn().mockResolvedValue([
        [
          { legacyId: 9038, tipo: 98, observacao: 'R$ 302 Thiago' },
          { legacyId: 9038, tipo: 99, observacao: 'Retirar após as 14h' },
          { legacyId: 9101, tipo: 98, observacao: 'CHAVE PIX' },
        ],
      ]),
    } as any;

    const notas = await readLegacyNotes(legacy, 'acn_000320');

    expect(notas.get('9038')).toEqual({
      payment: 'R$ 302 Thiago',
      delivery: 'Retirar após as 14h',
    });
    expect(notas.get('9101')).toEqual({ payment: 'CHAVE PIX', delivery: '' });
    expect(legacy.query.mock.calls[0][0]).toContain('IN (98, 99)');
  });
});

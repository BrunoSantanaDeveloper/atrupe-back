import { aggregateStatus, itemsToApply } from './stage-aggregate';

describe('a etapa do pedido como resumo dos itens (§4.7)', () => {
  it('pendência em algum item deixa o pedido com pendência', () => {
    expect(aggregateStatus(['DONE', 'PENDING', 'IN_PROGRESS'])).toBe('PENDING');
  });

  it('algum em andamento ou pausado', () => {
    expect(aggregateStatus(['NOT_STARTED', 'IN_PROGRESS'])).toBe('IN_PROGRESS');
    expect(aggregateStatus(['DONE', 'PAUSED'])).toBe('PAUSED');
  });

  it('todos fechados: finalizado; todos cancelados: cancelado', () => {
    expect(aggregateStatus(['DONE', 'CANCELED'])).toBe('DONE');
    expect(aggregateStatus(['CANCELED', 'CANCELED'])).toBe('CANCELED');
  });

  it('nenhum começou: não iniciado; uns prontos e outros não: em andamento', () => {
    expect(aggregateStatus(['NOT_STARTED', 'NOT_STARTED'])).toBe('NOT_STARTED');
    expect(aggregateStatus(['DONE', 'NOT_STARTED'])).toBe('IN_PROGRESS');
    expect(aggregateStatus([])).toBe('NOT_STARTED');
  });

  it('a ação do pedido vale para os itens abertos; reiniciar vale para todos', () => {
    const items = [
      { id: 'a', status: 'DONE' as const },
      { id: 'b', status: 'IN_PROGRESS' as const },
      { id: 'c', status: 'NOT_STARTED' as const },
    ];
    expect(itemsToApply(items, 'DONE').map((i) => i.id)).toEqual(['b', 'c']);
    expect(itemsToApply(items, 'NOT_STARTED').map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

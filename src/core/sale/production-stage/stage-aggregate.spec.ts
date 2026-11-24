import {
  ItemStage,
  aggregateStatus,
  itemChanges,
  orderStatusAfter,
} from './stage-aggregate';

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
    const items: ItemStage[] = [
      { id: 'a', status: 'DONE' },
      { id: 'b', status: 'IN_PROGRESS' },
      { id: 'c', status: 'NOT_STARTED' },
    ];
    expect(itemChanges(items, 'IN_PROGRESS', 'DONE')).toEqual([
      { id: 'b', status: 'DONE', prevStatus: 'IN_PROGRESS' },
      { id: 'c', status: 'DONE', prevStatus: 'NOT_STARTED' },
    ]);
    expect(itemChanges(items, 'DONE', 'NOT_STARTED').map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('tirar a pendência e continuar devolvem a cada item o próprio anterior', () => {
    const items: ItemStage[] = [
      { id: 'a', status: 'PENDING', prevStatus: 'IN_PROGRESS' },
      { id: 'b', status: 'PENDING', prevStatus: 'NOT_STARTED' },
      { id: 'c', status: 'DONE', prevStatus: 'IN_PROGRESS' },
      // Sem anterior que sirva: vai para o estado pedido
      { id: 'd', status: 'PENDING', prevStatus: 'PENDING' },
    ];
    expect(itemChanges(items, 'PENDING', 'IN_PROGRESS')).toEqual([
      { id: 'a', status: 'IN_PROGRESS', prevStatus: 'PENDING' },
      { id: 'b', status: 'NOT_STARTED', prevStatus: 'PENDING' },
      { id: 'd', status: 'IN_PROGRESS', prevStatus: 'PENDING' },
    ]);
    expect(
      itemChanges(
        [{ id: 'a', status: 'PAUSED', prevStatus: 'NOT_STARTED' }],
        'PAUSED',
        'IN_PROGRESS',
      ),
    ).toEqual([{ id: 'a', status: 'NOT_STARTED', prevStatus: 'PAUSED' }]);
  });

  it('a pendência posta num pedido pausado volta para a pausa', () => {
    const items: ItemStage[] = [
      { id: 'a', status: 'PENDING', prevStatus: 'PAUSED' },
      { id: 'b', status: 'DONE', prevStatus: 'IN_PROGRESS' },
    ];
    expect(itemChanges(items, 'PENDING', 'PAUSED')).toEqual([
      { id: 'a', status: 'PAUSED', prevStatus: 'PENDING' },
    ]);
    // Continuar depois: sem o que fazia antes da pausa, vai em andamento
    expect(
      itemChanges(
        [{ id: 'a', status: 'PAUSED', prevStatus: 'PENDING' }],
        'PAUSED',
        'IN_PROGRESS',
      ),
    ).toEqual([{ id: 'a', status: 'IN_PROGRESS', prevStatus: 'PAUSED' }]);
  });

  it('o item que já está no estado pedido guarda o anterior', () => {
    const items: ItemStage[] = [
      { id: 'a', status: 'PENDING', prevStatus: 'IN_PROGRESS' },
      { id: 'b', status: 'IN_PROGRESS' },
    ];
    expect(itemChanges(items, 'IN_PROGRESS', 'PENDING')).toEqual([
      { id: 'b', status: 'PENDING', prevStatus: 'IN_PROGRESS' },
    ]);
  });

  it('voltar o pedido fechado reabre os itens que estavam como ele', () => {
    const items: ItemStage[] = [
      { id: 'a', status: 'DONE' },
      { id: 'b', status: 'CANCELED' },
    ];
    expect(itemChanges(items, 'DONE', 'IN_PROGRESS')).toEqual([
      { id: 'a', status: 'IN_PROGRESS', prevStatus: 'DONE' },
    ]);
    expect(itemChanges(items, 'CANCELED', 'IN_PROGRESS')).toEqual([
      { id: 'b', status: 'IN_PROGRESS', prevStatus: 'CANCELED' },
    ]);
  });

  it('cancelar pelo pedido fica cancelado mesmo com item finalizado', () => {
    expect(orderStatusAfter(['DONE', 'CANCELED'], 'CANCELED')).toBe('CANCELED');
    // A troca num item segue o resumo: o setor terminou o que tinha a fazer
    expect(orderStatusAfter(['DONE', 'CANCELED'])).toBe('DONE');
    expect(orderStatusAfter(['DONE', 'IN_PROGRESS'], 'CANCELED')).toBe(
      'IN_PROGRESS',
    );
  });
});

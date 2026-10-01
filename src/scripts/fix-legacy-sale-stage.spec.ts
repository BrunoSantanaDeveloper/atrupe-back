import { targetStage } from './fix-legacy-sale-stage';

/**
 * As cargas anteriores decidiam a etapa pelo status da entrega, e o cliente
 * quase nunca marca esse passo: a O.S. pronta ficava em produção na conta nova.
 * Este script corrige o que já entrou, e precisa ser seguro para rodar de novo
 * e para rodar numa conta que já está em uso.
 */
describe('targetStage', () => {
  const venda = (over: any = {}) => ({
    legacyId: '9165',
    statusLegado: 3,
    substatusLegado: 905,
    etapaLegado: 3,
    statusEntrega: 2,
    ...over,
  });

  const ordem = (status = 'IN_PRODUCTION') => ({
    status: 'APPROVED',
    order: { status },
  });

  const orcamento = (status = 'OPEN') => ({ status, order: null });

  it('conclui a ordem que o legado deixou na entrega', () => {
    expect(targetStage(venda(), ordem())).toEqual({ orderStatus: 'FINISHED' });
    expect(targetStage(venda({ etapaLegado: 4 }), ordem())).toEqual({
      orderStatus: 'FINISHED',
    });
  });

  it('deixa em produção a ordem que o legado não concluiu', () => {
    expect(targetStage(venda({ etapaLegado: 1 }), ordem())).toBeNull();
    expect(targetStage(venda({ etapaLegado: 2 }), ordem())).toBeNull();
  });

  it('cancela a ordem cancelada no legado', () => {
    expect(targetStage(venda({ statusLegado: 4 }), ordem())).toEqual({
      orderStatus: 'CANCELED',
    });
  });

  it('não rebaixa a ordem que já saiu de produção no Atrupe', () => {
    // Pode ter sido concluída ou cancelada depois da migração.
    expect(targetStage(venda(), ordem('FINISHED'))).toBeNull();
    expect(
      targetStage(venda({ etapaLegado: 1 }), ordem('FINISHED')),
    ).toBeNull();
    expect(
      targetStage(venda({ statusLegado: 4 }), ordem('CANCELED')),
    ).toBeNull();
  });

  it('cai no status da entrega quando a etapa não vem', () => {
    const semEtapa = { etapaLegado: null, statusEntrega: 4 };

    expect(targetStage(venda(semEtapa), ordem())).toEqual({
      orderStatus: 'FINISHED',
    });
    expect(
      targetStage(venda({ ...semEtapa, statusEntrega: 2 }), ordem()),
    ).toBeNull();
  });

  it('põe em aguardando o orçamento fechado no legado', () => {
    const fechado = { statusLegado: 1, etapaLegado: 2 };

    expect(targetStage(venda(fechado), orcamento())).toEqual({
      quotationStatus: 'DONE',
    });
  });

  it('deixa em digitação o orçamento que o legado não fechou', () => {
    expect(
      targetStage(venda({ statusLegado: 1, etapaLegado: 1 }), orcamento()),
    ).toBeNull();
  });

  it('rejeita o "orçamento cancelado" do legado', () => {
    // Os substatus do status 2 são motivos de perda: é o Rejeitados da tela.
    expect(
      targetStage(venda({ statusLegado: 2, etapaLegado: 34 }), orcamento()),
    ).toEqual({ quotationStatus: 'REJECTED' });
  });

  it('não mexe no orçamento que já saiu de digitação', () => {
    const fechado = { statusLegado: 1, etapaLegado: 2 };

    expect(targetStage(venda(fechado), orcamento('APPROVED'))).toBeNull();
    expect(targetStage(venda(fechado), orcamento('DONE'))).toBeNull();
    expect(targetStage(venda(fechado), orcamento('REJECTED'))).toBeNull();
  });
});

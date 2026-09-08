import {
  avaliarPrazoCancelamento,
  orientacaoRejeicaoCancelamento,
  LIMITE_MAXIMO_HORAS,
  PRAZO_REGULAR_HORAS,
} from './prazo-cancelamento.util';

/** Instante de referência fixo, para os cálculos não dependerem do relógio. */
const AGORA = new Date('2026-09-10T12:00:00Z');
const horasAtras = (horas: number) =>
  new Date(AGORA.getTime() - horas * 60 * 60 * 1000);

describe('avaliarPrazoCancelamento', () => {
  it('dentro de 24 horas é cancelamento comum, sem aviso', () => {
    const r = avaliarPrazoCancelamento({
      autorizadaEm: horasAtras(5),
      agora: AGORA,
    });

    expect(r.dentroDoPrazoRegular).toBe(true);
    expect(r.podeTentar).toBe(true);
    expect(r.aviso).toBeUndefined();
    expect(r.bloqueio).toBeUndefined();
  });

  it('exatamente 24 horas ainda é prazo regular', () => {
    const r = avaliarPrazoCancelamento({
      autorizadaEm: horasAtras(PRAZO_REGULAR_HORAS),
      agora: AGORA,
    });

    expect(r.dentroDoPrazoRegular).toBe(true);
  });

  /**
   * O caso que motivou a mudança: São Paulo recebe o evento até 480 horas.
   * A regra antiga barrava em 24 e o usuário não conseguia nem tentar.
   */
  it('passadas 48 horas, deixa tentar e avisa sobre penalidade', () => {
    const r = avaliarPrazoCancelamento({
      autorizadaEm: horasAtras(48),
      agora: AGORA,
    });

    expect(r.dentroDoPrazoRegular).toBe(false);
    expect(r.podeTentar).toBe(true);
    expect(r.aviso).toMatch(/extempor/i);
    expect(r.aviso).toMatch(/2 dias/);
  });

  it('em 480 horas (o prazo de São Paulo) ainda deixa tentar', () => {
    const r = avaliarPrazoCancelamento({
      autorizadaEm: horasAtras(480),
      agora: AGORA,
    });

    expect(r.podeTentar).toBe(true);
  });

  it('acima do teto conhecido, bloqueia e manda ao posto fiscal', () => {
    const r = avaliarPrazoCancelamento({
      autorizadaEm: horasAtras(LIMITE_MAXIMO_HORAS + 1),
      agora: AGORA,
    });

    expect(r.podeTentar).toBe(false);
    expect(r.bloqueio).toMatch(/SEFAZ/);
  });

  it('respeita o limite configurado no emissor', () => {
    const params = { autorizadaEm: horasAtras(100), agora: AGORA };

    expect(
      avaliarPrazoCancelamento({ ...params, limiteConfiguradoHoras: 48 })
        .podeTentar,
    ).toBe(false);
    expect(
      avaliarPrazoCancelamento({ ...params, limiteConfiguradoHoras: 480 })
        .podeTentar,
    ).toBe(true);
  });

  /**
   * O prazo legal corre da autorização de uso, não da emissão. Em nota
   * autorizada muito depois de emitida, contar da emissão bloquearia cedo.
   */
  it('conta da autorização, não da emissão', () => {
    const r = avaliarPrazoCancelamento({
      emitidaEm: horasAtras(200),
      autorizadaEm: horasAtras(2),
      agora: AGORA,
    });

    expect(r.dentroDoPrazoRegular).toBe(true);
  });

  it('sem autorização registrada, cai na emissão', () => {
    const r = avaliarPrazoCancelamento({
      emitidaEm: horasAtras(2),
      autorizadaEm: null,
      agora: AGORA,
    });

    expect(r.dentroDoPrazoRegular).toBe(true);
  });

  /** Sem data nenhuma, quem decide é a SEFAZ — bloquear seria chutar. */
  it('sem data nenhuma, deixa tentar e explica', () => {
    const r = avaliarPrazoCancelamento({ agora: AGORA });

    expect(r.podeTentar).toBe(true);
    expect(r.aviso).toMatch(/SEFAZ/);
  });
});

describe('orientacaoRejeicaoCancelamento', () => {
  it('explica a rejeição 501, que só diz "prazo superior ao previsto"', () => {
    expect(orientacaoRejeicaoCancelamento(501)).toMatch(/posto fiscal/);
  });

  it('não inventa orientação para código desconhecido', () => {
    expect(orientacaoRejeicaoCancelamento(999)).toBeNull();
    expect(orientacaoRejeicaoCancelamento(undefined)).toBeNull();
  });
});

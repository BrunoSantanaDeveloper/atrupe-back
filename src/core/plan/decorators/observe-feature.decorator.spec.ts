import { isObservingNow } from './observe-feature.decorator';

describe('modo observar com data de corte', () => {
  const ENV = 'TESTE_CORTE_RECURSO';
  afterEach(() => delete process.env[ENV]);

  it('true observa sempre; sem marca, não observa', () => {
    expect(isObservingNow(true)).toBe(true);
    expect(isObservingNow(false)).toBe(false);
    expect(isObservingNow(undefined)).toBe(false);
  });

  it('sem a variável, observa', () => {
    expect(isObservingNow({ untilEnv: ENV })).toBe(true);
  });

  it('observa até a data e recusa a partir dela', () => {
    process.env[ENV] = '2026-11-15';
    expect(
      isObservingNow({ untilEnv: ENV }, new Date('2026-11-14T23:00:00Z')),
    ).toBe(true);
    expect(
      isObservingNow({ untilEnv: ENV }, new Date('2026-11-15T00:00:00Z')),
    ).toBe(false);
  });

  it('data inválida não recusa ninguém', () => {
    process.env[ENV] = 'amanhã';
    expect(isObservingNow({ untilEnv: ENV })).toBe(true);
  });
});

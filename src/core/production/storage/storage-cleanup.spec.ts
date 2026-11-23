import {
  autoCleanupDue,
  autoCleanupSkip,
  cleanupConfirmed,
  pickOldest,
} from './storage-cleanup';

const MB = 1024 * 1024;
const file = (id: string, day: string, mb: number, projectId = 'p1') => ({
  id,
  taskId: `t-${id}`,
  projectId,
  size: mb * MB,
  uploadedAt: new Date(`${day}T12:00:00Z`),
});

describe('pickOldest (limpeza do espaço, GP-49)', () => {
  it('apaga do mais antigo até liberar a porcentagem do espaço usado', () => {
    const result = pickOldest(
      [
        file('c', '2026-03-01', 30, 'p2'),
        file('a', '2026-01-01', 20),
        file('b', '2026-02-01', 40),
        file('d', '2026-04-01', 10, 'p3'),
      ],
      200 * MB,
      50,
    );
    expect(result.targetBytes).toBe(100 * MB);
    expect(result.picked.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.bytes).toBe(100 * MB);
    expect(result.projects).toBe(3);
    expect(result.from).toEqual(new Date('2026-01-01T12:00:00Z'));
    expect(result.to).toEqual(new Date('2026-04-01T12:00:00Z'));
  });

  it('para assim que alcança o alvo', () => {
    const result = pickOldest(
      [file('a', '2026-01-01', 60), file('b', '2026-02-01', 60)],
      200 * MB,
      25,
    );
    expect(result.picked.map((item) => item.id)).toEqual(['a']);
    expect(result.bytes).toBe(60 * MB);
  });

  it('sem O.S. entregue, não há o que apagar', () => {
    const result = pickOldest([], 500 * MB, 50);
    expect(result.picked).toEqual([]);
    expect(result.eligibleBytes).toBe(0);
    expect(result.from).toBeNull();
  });

  it('o elegível menor que o alvo apaga tudo o que pode', () => {
    const result = pickOldest([file('a', '2026-01-01', 10)], 200 * MB, 50);
    expect(result.bytes).toBe(10 * MB);
    expect(result.eligibleBytes).toBe(10 * MB);
  });
});

describe('autoCleanupDue', () => {
  it('roda só com cota e acima do limite', () => {
    expect(autoCleanupDue({ usedBytes: 95, quotaBytes: 100 }, 90)).toBe(true);
    expect(autoCleanupDue({ usedBytes: 80, quotaBytes: 100 }, 90)).toBe(false);
    expect(autoCleanupDue({ usedBytes: 80, quotaBytes: null }, 90)).toBe(false);
  });
});

describe('autoCleanupSkip', () => {
  it('sem assinatura ativa ou com o teste vencido, o automático espera', () => {
    expect(autoCleanupSkip(null)).toBe('sem assinatura ativa');
    expect(autoCleanupSkip({ planType: 'TRIAL', isTrialActive: false })).toBe(
      'teste grátis vencido',
    );
  });

  it('com a assinatura ativa, roda', () => {
    expect(autoCleanupSkip({ planType: 'PRO', isTrialActive: false })).toBe(
      null,
    );
    expect(autoCleanupSkip({ planType: 'TRIAL', isTrialActive: true })).toBe(
      null,
    );
  });
});

describe('cleanupConfirmed', () => {
  it('aceita APAGAR digitado de qualquer jeito, e só ele', () => {
    expect(cleanupConfirmed(' apagar ')).toBe(true);
    expect(cleanupConfirmed('APAGA')).toBe(false);
    expect(cleanupConfirmed(undefined)).toBe(false);
  });
});

import {
  FILE_TOO_LARGE,
  FREE_FILE_MAX_BYTES,
  GB,
  MB,
  refusalOf,
  STORAGE_FULL,
  storageSummary,
  TIER_FILE_MAX_BYTES,
} from './production-files.service';

const T200 = {
  key: 'production_storage_200gb',
  name: 'Arquivos de produção · 200 GB',
  storageGb: 200,
};

describe('o espaço dos arquivos de produção (GP-48 item 27)', () => {
  it('sem faixa: a cota grátis do plano e o arquivo de até 20 MB', () => {
    const summary = storageSummary({
      usedBytes: 300 * MB,
      freeMb: 1024,
      tier: null,
    });
    expect(summary.quotaBytes).toBe(1024 * MB);
    expect(summary.freeBytes).toBe(724 * MB);
    expect(summary.maxFileBytes).toBe(FREE_FILE_MAX_BYTES);
  });

  it('sem o limite no plano, vale a partida de 1 GB', () => {
    expect(
      storageSummary({ usedBytes: 0, freeMb: undefined, tier: null })
        .quotaBytes,
    ).toBe(GB);
  });

  it('com a faixa: a cota grátis mais a faixa, e o arquivo de até 2 GB', () => {
    const summary = storageSummary({
      usedBytes: 0,
      freeMb: 1024,
      tier: T200,
    });
    expect(summary.quotaBytes).toBe(201 * GB);
    expect(summary.maxFileBytes).toBe(TIER_FILE_MAX_BYTES);
  });

  it('plano sem limite (-1): sem teto de espaço', () => {
    const summary = storageSummary({
      usedBytes: 5 * GB,
      freeMb: -1,
      tier: null,
    });
    expect(summary.quotaBytes).toBeNull();
    expect(refusalOf(summary, 10 * MB)).toBeNull();
  });

  it('recusa o arquivo grande demais e o que não cabe no espaço', () => {
    const free = storageSummary({
      usedBytes: 1000 * MB,
      freeMb: 1024,
      tier: null,
    });
    expect(refusalOf(free, 21 * MB)?.code).toBe(FILE_TOO_LARGE);
    expect(refusalOf(free, 19 * MB)?.code).toBeUndefined();
    expect(refusalOf(free, 19 * MB)).toBeNull();
    const full = { ...free, usedBytes: 1020 * MB };
    expect(refusalOf(full, 5 * MB)?.code).toBe(STORAGE_FULL);
  });
});

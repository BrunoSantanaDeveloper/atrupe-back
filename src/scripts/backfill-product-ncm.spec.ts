import {
  needsNcm,
  resolveCompanyDefaults,
  hasNotaFiscalFeature,
  FALLBACK_NCM,
  FALLBACK_CFOP_IN_STATE,
} from './backfill-product-ncm';

describe('backfill-product-ncm', () => {
  describe('needsNcm', () => {
    it('marca null, undefined e vazio como pendentes', () => {
      expect(needsNcm(null)).toBe(true);
      expect(needsNcm(undefined)).toBe(true);
      expect(needsNcm('')).toBe(true);
      expect(needsNcm('   ')).toBe(true);
    });

    it('não toca NCM preenchido, mesmo inválido', () => {
      expect(needsNcm('49119900')).toBe(false);
      // Inválido foi preenchido de propósito — fora do escopo do backfill
      expect(needsNcm('123')).toBe(false);
      expect(needsNcm('00000000')).toBe(false);
    });
  });

  describe('resolveCompanyDefaults', () => {
    const config = (
      overrides: Partial<Parameters<typeof resolveCompanyDefaults>[0][0]>,
    ) => ({
      isDefault: false,
      createdAt: new Date('2026-01-01'),
      defaultNcm: null,
      defaultCfop: null,
      ...overrides,
    });

    it('prefere a config isDefault', () => {
      const result = resolveCompanyDefaults([
        config({ createdAt: new Date('2025-01-01'), defaultNcm: '11111111' }),
        config({ isDefault: true, defaultNcm: '22222222' }),
      ]);
      expect(result.ncm).toBe('22222222');
    });

    it('sem isDefault, usa a config mais antiga', () => {
      const result = resolveCompanyDefaults([
        config({ createdAt: new Date('2026-05-01'), defaultNcm: '11111111' }),
        config({ createdAt: new Date('2025-01-01'), defaultNcm: '22222222' }),
      ]);
      expect(result.ncm).toBe('22222222');
    });

    it('cai no fallback fixo sem configs ou sem defaultNcm', () => {
      expect(resolveCompanyDefaults([]).ncm).toBe(FALLBACK_NCM);
      expect(resolveCompanyDefaults([]).cfopInState).toBe(
        FALLBACK_CFOP_IN_STATE,
      );
      expect(resolveCompanyDefaults([config({})]).ncm).toBe(FALLBACK_NCM);
    });

    it('resolve o CFOP da mesma config escolhida', () => {
      const result = resolveCompanyDefaults([
        config({
          isDefault: true,
          defaultNcm: '22222222',
          defaultCfop: '5102',
        }),
      ]);
      expect(result.cfopInState).toBe('5102');
    });

    /** O CST de ICMS do cadastro criado depende do regime do emissor. */
    it('resolve o CRT da mesma config escolhida', () => {
      expect(
        resolveCompanyDefaults([config({ isDefault: true, emitCrt: 3 })])
          .emitCrt,
      ).toBe(3);
      expect(resolveCompanyDefaults([]).emitCrt).toBeNull();
      expect(resolveCompanyDefaults([config({})]).emitCrt).toBeNull();
    });
  });

  describe('hasNotaFiscalFeature', () => {
    const sub = (planKeys: string[], addOns: [string, boolean][] = []) => ({
      plan: {
        planFeatures: planKeys.map((key) => ({ feature: { key } })),
      },
      subscriptionFeatures: addOns.map(([key, isActive]) => ({
        isActive,
        feature: { key },
      })),
    });

    it('reconhece feature do plano base', () => {
      expect(hasNotaFiscalFeature([sub(['nota_fiscal'])])).toBe(true);
    });

    it('reconhece add-on ativo da subscription', () => {
      expect(hasNotaFiscalFeature([sub([], [['nota_fiscal', true]])])).toBe(
        true,
      );
    });

    it('ignora add-on inativo', () => {
      expect(hasNotaFiscalFeature([sub([], [['nota_fiscal', false]])])).toBe(
        false,
      );
    });

    it('nega sem subscription ativa ou sem a feature', () => {
      expect(hasNotaFiscalFeature([])).toBe(false);
      expect(hasNotaFiscalFeature([sub(['crm'])])).toBe(false);
    });
  });
});

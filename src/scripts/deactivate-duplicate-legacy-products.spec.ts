import {
  normalizeName,
  hasMigrationSignature,
  hasAmbiguousLegacyLinks,
  pickSurvivor,
  DuplicateCandidate,
} from './deactivate-duplicate-legacy-products';

const produto = (
  overrides: Partial<DuplicateCandidate> & { id: string },
): DuplicateCandidate => ({
  name: 'Produto',
  code: 'COD',
  legacyId: null,
  isActive: true,
  usos: 0,
  ...overrides,
});

describe('deactivate-duplicate-legacy-products', () => {
  describe('normalizeName', () => {
    it('ignora acento, caixa e espaço repetido', () => {
      expect(normalizeName('  Fachada   Acrílico ')).toBe('FACHADA ACRILICO');
      expect(normalizeName('FACHADA ACRILICO')).toBe('FACHADA ACRILICO');
    });

    it('trata nome ausente', () => {
      expect(normalizeName(null)).toBe('');
      expect(normalizeName(undefined)).toBe('');
    });
  });

  describe('hasMigrationSignature', () => {
    it('reconhece o par que a migração duplicou', () => {
      expect(
        hasMigrationSignature([
          produto({ id: 'a', legacyId: 'ACM-34' }),
          produto({ id: 'b', legacyId: null }),
        ]),
      ).toBe(true);
    });

    it('ignora duplicata que o cliente cadastrou à mão', () => {
      // "BALCAO ILHA" em LOC. e VENDA: nenhuma das duas veio do legado.
      expect(
        hasMigrationSignature([
          produto({ id: 'a', code: 'LOC.' }),
          produto({ id: 'b', code: 'VENDA' }),
        ]),
      ).toBe(false);
    });

    it('ignora grupo em que todas vieram do legado', () => {
      expect(
        hasMigrationSignature([
          produto({ id: 'a', legacyId: 'ART-194' }),
          produto({ id: 'b', legacyId: 'ART-195' }),
        ]),
      ).toBe(false);
    });
  });

  describe('hasAmbiguousLegacyLinks', () => {
    it('acusa dois produtos distintos do legado com o mesmo nome', () => {
      // ART-194 e ART-195 são cadastros diferentes no legado; inativar um
      // deles sumiria com produto legítimo.
      expect(
        hasAmbiguousLegacyLinks([
          produto({ id: 'a', legacyId: 'ART-194' }),
          produto({ id: 'b', legacyId: 'ART-195' }),
          produto({ id: 'c', legacyId: null }),
        ]),
      ).toBe(true);
    });

    it('não acusa o par com um só vínculo', () => {
      expect(
        hasAmbiguousLegacyLinks([
          produto({ id: 'a', legacyId: 'ACM-34' }),
          produto({ id: 'b', legacyId: null }),
        ]),
      ).toBe(false);
    });
  });

  describe('pickSurvivor', () => {
    it('mantém a cópia mais usada em orçamentos', () => {
      const survivor = pickSurvivor([
        produto({ id: 'a', legacyId: 'VINIL-23', usos: 29 }),
        produto({ id: 'b', legacyId: null, usos: 57 }),
      ]);

      expect(survivor.id).toBe('b');
    });

    it('no empate fica a que tem vínculo com o legado', () => {
      const survivor = pickSurvivor([
        produto({ id: 'a', legacyId: null, usos: 7 }),
        produto({ id: 'b', legacyId: 'CTV', usos: 7 }),
      ]);

      expect(survivor.id).toBe('b');
    });

    it('respeita o sobrevivente forçado na linha de comando', () => {
      const survivor = pickSurvivor(
        [
          produto({ id: 'a', legacyId: 'ACM-34', usos: 99 }),
          produto({ id: 'b', legacyId: null, usos: 1 }),
        ],
        new Set(['b']),
      );

      expect(survivor.id).toBe('b');
    });
  });
});

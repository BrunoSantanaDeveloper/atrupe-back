import * as fs from 'fs';
import * as path from 'path';
import { BASE_FEATURES } from '../../seeds/features-base';
import { PLAN_CONFIGURATIONS } from '../../seeds/plans-complete';
import {
  dependentsOf,
  FEATURE_CATEGORY_LABELS,
  FEATURE_DEPENDENCIES,
  FEATURE_ENFORCEMENT,
  PLAN_FEATURE_KEYS,
  PlanFeatureKey,
} from './plan-feature-rules';

/**
 * A chave de recurso é o contrato entre o código (o que ela libera) e o dado
 * (quem a tem). Estes testes travam o contrato: uma chave nova precisa estar
 * nos dois lados, e todo bloqueio no código precisa usar uma chave que exista.
 */
describe('plan-feature-rules', () => {
  const planFeaturesInCatalog = BASE_FEATURES.filter((f) => f.price === 0).map(
    (f) => f.key,
  );
  const allCatalogKeys = BASE_FEATURES.map((f) => f.key);

  it('as chaves de plano do código são as do catálogo (preço zero)', () => {
    expect([...PLAN_FEATURE_KEYS].sort()).toEqual(
      [...planFeaturesInCatalog].sort(),
    );
  });

  it('toda chave tem onde é aplicada descrito', () => {
    for (const key of PLAN_FEATURE_KEYS) {
      expect(FEATURE_ENFORCEMENT[key]).toBeDefined();
      expect(FEATURE_ENFORCEMENT[key].detail.length).toBeGreaterThan(0);
    }
  });

  it('toda categoria do catálogo tem rótulo', () => {
    for (const feature of BASE_FEATURES.filter((f) => f.price === 0)) {
      expect(FEATURE_CATEGORY_LABELS[feature.category]).toBeDefined();
    }
  });

  it('as dependências usam chaves conhecidas, sem dependência de si mesma', () => {
    for (const [key, deps] of Object.entries(FEATURE_DEPENDENCIES)) {
      expect(PLAN_FEATURE_KEYS).toContain(key);
      for (const dep of deps) {
        expect(PLAN_FEATURE_KEYS).toContain(dep);
        expect(dep).not.toBe(key);
      }
    }
  });

  it('as dependências não têm ciclo', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (key: string) => {
      if (done.has(key)) return;
      if (visiting.has(key)) throw new Error(`ciclo em ${key}`);
      visiting.add(key);
      for (const dep of FEATURE_DEPENDENCIES[key as PlanFeatureKey] ?? []) {
        visit(dep);
      }
      visiting.delete(key);
      done.add(key);
    };
    expect(() => PLAN_FEATURE_KEYS.forEach(visit)).not.toThrow();
  });

  it('dependentsOf é o inverso das dependências', () => {
    expect(dependentsOf('delivery_production_tabs').sort()).toEqual(
      ['delivery_production_stages', 'delivery_stage_status_change'].sort(),
    );
    expect(dependentsOf('pdv_screen')).toEqual([]);
  });

  it('o padrão de fábrica de cada plano respeita as dependências', () => {
    for (const config of Object.values(PLAN_CONFIGURATIONS)) {
      const features = new Set<string>(config.features);
      for (const key of features) {
        for (const dep of FEATURE_DEPENDENCIES[key as PlanFeatureKey] ?? []) {
          expect({
            plan: config.plan.planType,
            key,
            dep,
            ok: features.has(dep),
          }).toEqual({ plan: config.plan.planType, key, dep, ok: true });
        }
      }
    }
  });

  it('Setores nasce no Start e no Trial (decisão do PO de 29/09/2026)', () => {
    expect(PLAN_CONFIGURATIONS.START.features).toContain(
      'sectors_configuration',
    );
    expect(PLAN_CONFIGURATIONS.TRIAL.features).toContain(
      'sectors_configuration',
    );
    expect(PLAN_CONFIGURATIONS.LITE.features).toContain(
      'sectors_configuration',
    );
  });

  it('todo bloqueio no código usa uma chave do catálogo', () => {
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'examples' || entry.name === 'node_modules') {
            continue;
          }
          walk(full);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts')
        ) {
          files.push(full);
        }
      }
    };
    walk(root);

    const used = new Set<string>();
    const patterns = [
      /RequiresFeature[(][ ]*'([a-z_]+)'/g,
      /enforceFeature[(][^)]*?'([a-z_]+)'/g,
      /hasFeature[(][^)]*?'([a-z_]+)'/g,
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) used.add(match[1]);
      }
    }

    expect(used.size).toBeGreaterThan(10);
    const unknown = [...used].filter((key) => !allCatalogKeys.includes(key));
    expect(unknown).toEqual([]);
  });
});

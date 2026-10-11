import * as fs from 'fs';
import * as path from 'path';
import { BASE_FEATURES } from '../../seeds/features-base';
import { PLAN_CONFIGURATIONS } from '../../seeds/plans-complete';
import {
  cumulativeViolations,
  dependentsOf,
  FEATURE_CATEGORY_LABELS,
  FEATURE_CATEGORY_ORDER,
  FEATURE_DEPENDENCIES,
  FEATURE_ENFORCEMENT,
  PLAN_FEATURE_KEYS,
  PlanFeatureKey,
} from './plan-feature-rules';

/** Os planos da regra cumulativa (o Trial fica fora), do menor ao maior. */
const cumulativeChain = () =>
  Object.values(PLAN_CONFIGURATIONS)
    .filter((config) => config.plan.planType !== 'TRIAL')
    .sort((a, b) => a.plan.order - b.plan.order);

/**
 * A chave de recurso é o contrato entre o código (o que ela libera) e o dado
 * (quem a tem). Estes testes travam o contrato: uma chave nova precisa estar
 * nos dois lados, e todo bloqueio no código precisa usar uma chave que exista.
 */
describe('plan-feature-rules', () => {
  // Só os ativos: um recurso aposentado fica no catálogo como inativo.
  const planFeaturesInCatalog = BASE_FEATURES.filter(
    (f) => f.price === 0 && f.isActive,
  ).map((f) => f.key);
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

  it('toda categoria do catálogo tem rótulo e lugar na ordem da matriz', () => {
    for (const feature of BASE_FEATURES.filter((f) => f.price === 0)) {
      expect(FEATURE_CATEGORY_LABELS[feature.category]).toBeDefined();
      expect(FEATURE_CATEGORY_ORDER).toContain(feature.category);
    }
  });

  it('basic_* não existem e o motivo obrigatório de rejeição segue aposentado', () => {
    expect(allCatalogKeys.filter((key) => key.startsWith('basic_'))).toEqual(
      [],
    );
    const retired = BASE_FEATURES.find(
      (f) => f.key === 'quotation_require_rejection_reason',
    );
    expect(retired?.isActive).toBe(false);
    expect(PLAN_FEATURE_KEYS).not.toContain(
      'quotation_require_rejection_reason',
    );
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

  it('o padrão de fábrica é cumulativo: cada plano tem tudo o que o anterior tem', () => {
    const chain = cumulativeChain();
    expect(chain.map((c) => c.plan.planType)).toEqual([
      'START',
      'LITE',
      'PRO',
      'ELITE',
      'FULL',
    ]);
    for (let i = 1; i < chain.length; i++) {
      const lower = chain[i - 1];
      const higher = new Set<string>(chain[i].features);
      expect({
        lower: lower.plan.planType,
        missing: lower.features.filter((key) => !higher.has(key)),
      }).toEqual({ lower: lower.plan.planType, missing: [] });
    }
    // O teste gratuito começa com o que o Start tem.
    expect(PLAN_CONFIGURATIONS.TRIAL.features).toEqual(
      PLAN_CONFIGURATIONS.START.features,
    );
  });

  it('a conferência da regra cumulativa: vizinhos pela ordem, Trial fora', () => {
    const plan = (planType: string, order: number) => ({ planType, order });
    const trial = plan('TRIAL', 0);
    const start = plan('START', 1);
    const lite = plan('LITE', 2);
    const pro = plan('PRO', 3);

    expect(
      cumulativeViolations([
        { plan: pro, keys: ['a'] },
        { plan: trial, keys: ['x', 'y'] },
        { plan: start, keys: ['a'] },
        { plan: lite, keys: ['a', 'b', 'c'] },
      ]),
    ).toEqual([{ lowerPlan: lite, higherPlan: pro, keys: ['b', 'c'] }]);
    expect(
      cumulativeViolations(
        cumulativeChain().map((config) => ({
          plan: config.plan,
          keys: config.features,
        })),
      ),
    ).toEqual([]);
  });

  it('3 usuários em todos os planos (10/10/2026), e o texto do Lite diz 3', () => {
    expect(
      Object.values(PLAN_CONFIGURATIONS).map((config) => [
        config.plan.planType,
        config.limits.max_users,
      ]),
    ).toEqual([
      ['TRIAL', 3],
      ['START', 3],
      ['LITE', 3],
      ['PRO', 3],
      ['ELITE', 3],
      ['FULL', 3],
    ]);
    const liteTexts = PLAN_CONFIGURATIONS.LITE.featuresList.flatMap(
      (group) => group.items,
    );
    expect(liteTexts).toContain('3 usuários');
    expect(liteTexts).not.toContain('5 usuários');
  });

  it('as chaves de 10/10/2026 nascem no plano do contrato', () => {
    const firstPlan = (key: string) =>
      cumulativeChain().find((c) => c.features.includes(key))?.plan.planType ??
      null;

    expect({
      multiple_companies: firstPlan('multiple_companies'),
      transaction_cancel_reasons: firstPlan('transaction_cancel_reasons'),
      cost_base: firstPlan('cost_base'),
      pricing_center: firstPlan('pricing_center'),
      production_manager: firstPlan('production_manager'),
      productivity_tracking: firstPlan('productivity_tracking'),
      stock_control: firstPlan('stock_control'),
      invoice_entry: firstPlan('invoice_entry'),
      // Fora de todo plano até o PO decidir (acompanha a Agenda de entrega).
      can_bill_on_delivery_and_checkout: firstPlan(
        'can_bill_on_delivery_and_checkout',
      ),
    }).toEqual({
      multiple_companies: 'LITE',
      transaction_cancel_reasons: 'LITE',
      cost_base: 'PRO',
      pricing_center: 'PRO',
      production_manager: 'ELITE',
      productivity_tracking: 'ELITE',
      stock_control: 'FULL',
      invoice_entry: 'FULL',
      can_bill_on_delivery_and_checkout: null,
    });
    expect(PLAN_CONFIGURATIONS.TRIAL.features).not.toContain(
      'can_bill_on_delivery_and_checkout',
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

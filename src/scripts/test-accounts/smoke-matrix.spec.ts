import { readFileSync } from 'fs';
import { join } from 'path';
import { PLAN_CONFIGURATIONS } from '../../seeds/plans-complete';
import { PLAN_FIXTURES } from './fixtures';
import { TEST_PLAN_TYPES, TestPlanType } from './options';

/**
 * As matrizes do smoke por plano (scripts/smoke/*.json) conferidas contra o
 * padrão de fábrica e as contas de teste: uma chave que muda de plano no
 * catálogo sem o JSON acompanhar quebra aqui, no CI, e não no smoke de
 * homolog depois do deploy.
 */

const SMOKE_DIR = join(__dirname, '..', '..', '..', 'scripts', 'smoke');

function readSmokeJson(file: string): any {
  return JSON.parse(readFileSync(join(SMOKE_DIR, file), 'utf8'));
}

const factoryFeatures = (planType: TestPlanType): string[] =>
  PLAN_CONFIGURATIONS[planType].features;

describe('scripts/smoke/plan-expectations.json', () => {
  const { plans } = readSmokeJson('plan-expectations.json');

  it('tem uma entrada por plano das contas de teste', () => {
    expect(Object.keys(plans).sort()).toEqual([...TEST_PLAN_TYPES].sort());
  });

  it.each(TEST_PLAN_TYPES)(
    '%s: as chaves-sentinela batem com o padrão de fábrica',
    (planType) => {
      for (const key of plans[planType].has) {
        expect(factoryFeatures(planType)).toContain(key);
      }
      for (const key of plans[planType].hasNot) {
        expect(factoryFeatures(planType)).not.toContain(key);
      }
    },
  );

  it.each(TEST_PLAN_TYPES)(
    '%s: max_users do plano e usuários adicionais da conta de teste',
    (planType) => {
      expect(plans[planType].maxUsers).toBe(
        PLAN_CONFIGURATIONS[planType].limits.max_users,
      );
      expect(plans[planType].additionalUsers).toBe(
        PLAN_FIXTURES[planType].additionalUsers,
      );
    },
  );
});

describe('scripts/smoke/plan-gates.json', () => {
  const { planOrder, gates } = readSmokeJson('plan-gates.json');

  it('segue a ordem da trilha', () => {
    expect(planOrder).toEqual([...TEST_PLAN_TYPES]);
  });

  it.each(gates.map((gate: any) => [`${gate.method} ${gate.path}`, gate]))(
    '%s: o plano mínimo é o primeiro que tem a chave',
    (_label, gate: any) => {
      expect(gate.method).toBe('GET');
      expect(gate.path).toMatch(/^\//);
      const first = TEST_PLAN_TYPES.filter((plan) => plan !== 'TRIAL').find(
        (plan) => factoryFeatures(plan).includes(gate.feature),
      );
      expect(first).toBe(gate.minPlan);
      // O TRIAL (padrão igual ao START) fica abaixo de todo gate.
      expect(factoryFeatures('TRIAL')).not.toContain(gate.feature);
    },
  );
});

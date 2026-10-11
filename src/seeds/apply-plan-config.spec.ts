import {
  applyPlanDefaults,
  describePlanDefaultsResult,
  planDefaultsByType,
  PlanDefaultsConfig,
} from './apply-plan-config';
import { BASE_FEATURES } from './features-base';
import { PLAN_CONFIGURATIONS } from './plans-complete';

/**
 * Banco em memória com o mínimo que o seed usa: planos por nome, catálogo de
 * recursos e limites, e as linhas plano × recurso e plano × limite.
 */
function memoryDb(seed: {
  features: string[];
  limits: string[];
  planFeatures?: { planName: string; key: string; isActive: boolean }[];
  planLimits?: { planName: string; key: string; value: number }[];
  failOnPlan?: string;
  existingPlans?: { name: string; basePrice: number; presentation?: any }[];
}) {
  const plans: any[] = (seed.existingPlans ?? []).map((p) => ({
    id: `p-${p.name}`,
    ...p,
  }));
  const features = seed.features.map((key) => ({ id: `f-${key}`, key }));
  const limits = seed.limits.map((key) => ({ id: `l-${key}`, key }));
  const planFeatures: any[] = [];
  const planLimits: any[] = [];
  const planId = (name: string) => `p-${name}`;

  for (const pf of seed.planFeatures ?? []) {
    planFeatures.push({
      planId: planId(pf.planName),
      featureId: `f-${pf.key}`,
      isActive: pf.isActive,
    });
  }
  for (const pl of seed.planLimits ?? []) {
    planLimits.push({
      planId: planId(pl.planName),
      limitId: `l-${pl.key}`,
      value: pl.value,
    });
  }

  const prisma = {
    plan: {
      upsert: jest.fn(async ({ where, update, create }) => {
        if (where.name === seed.failOnPlan) throw new Error('falhou');
        let plan = plans.find((p) => p.name === where.name);
        if (plan) Object.assign(plan, update);
        else {
          plan = { id: planId(where.name), ...create };
          plans.push(plan);
        }
        return plan;
      }),
      update: jest.fn(async ({ where, data }) => {
        const plan = plans.find((p) => p.id === where.id);
        Object.assign(plan, data);
        return plan;
      }),
    },
    feature: {
      findMany: jest.fn(async ({ where }) =>
        features.filter((f) => where.key.in.includes(f.key)),
      ),
    },
    limit: {
      findUnique: jest.fn(
        async ({ where }) => limits.find((l) => l.key === where.key) ?? null,
      ),
    },
    planFeature: {
      findUnique: jest.fn(async ({ where }) => {
        const { planId: p, featureId } = where.planId_featureId;
        return (
          planFeatures.find(
            (r) => r.planId === p && r.featureId === featureId,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }) => {
        planFeatures.push({ ...data });
        return data;
      }),
      findMany: jest.fn(async ({ where }) =>
        planFeatures
          .filter((r) => r.planId === where.planId)
          .map((r) => ({
            isActive: r.isActive,
            feature: { key: r.featureId.replace('f-', '') },
          })),
      ),
    },
    planLimit: {
      findUnique: jest.fn(async ({ where }) => {
        const { planId: p, limitId } = where.planId_limitId;
        return (
          planLimits.find((r) => r.planId === p && r.limitId === limitId) ??
          null
        );
      }),
      create: jest.fn(async ({ data }) => {
        planLimits.push({ ...data });
        return data;
      }),
    },
  };
  return { prisma, planFeatures, planLimits, plans };
}

const config = (
  planType: string,
  name: string,
  features: string[],
  limits: Record<string, number>,
): PlanDefaultsConfig => ({
  plan: {
    planType,
    name,
    description: '',
    basePrice: 100,
    additionalUserPrice: 15,
    order: 1,
    isActive: true,
  },
  badge: null,
  concept: null,
  featuresList: null,
  features,
  limits,
});

describe('applyPlanDefaults', () => {
  it('cria os recursos e limites que faltam, ligados e com o valor do código', async () => {
    const db = memoryDb({ features: ['a', 'b'], limits: ['max_users'] });

    const result = await applyPlanDefaults(db.prisma as any, {
      START: config('START', 'Start', ['a', 'b'], { max_users: 3 }),
    });

    expect(result.featuresCreated).toBe(2);
    expect(result.limitsCreated).toBe(1);
    expect(db.planFeatures.every((r) => r.isActive)).toBe(true);
    expect(db.planLimits[0].value).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it('não liga de novo o que o superadmin desligou, nem volta o limite alterado', async () => {
    const db = memoryDb({
      features: ['a', 'b'],
      limits: ['max_users'],
      planFeatures: [
        { planName: 'Lite', key: 'a', isActive: false },
        { planName: 'Lite', key: 'b', isActive: true },
      ],
      planLimits: [{ planName: 'Lite', key: 'max_users', value: 8 }],
    });

    const result = await applyPlanDefaults(db.prisma as any, {
      LITE: config('LITE', 'Lite', ['a', 'b'], { max_users: 5 }),
    });

    expect(result.featuresCreated).toBe(0);
    expect(result.limitsCreated).toBe(0);
    expect(db.prisma.planFeature.create).not.toHaveBeenCalled();
    expect(db.planFeatures.find((r) => r.featureId === 'f-a').isActive).toBe(
      false,
    );
    expect(db.planLimits[0].value).toBe(8);
    expect(result.drift).toEqual([
      {
        planType: 'LITE',
        enabledOutsideDefault: [],
        disabledFromDefault: ['a'],
        limitsChanged: [{ key: 'max_users', value: 8, defaultValue: 5 }],
      },
    ]);
  });

  it('relata o que o painel ligou fora do padrão sem apagar', async () => {
    const db = memoryDb({
      features: ['a', 'x'],
      limits: [],
      planFeatures: [{ planName: 'Start', key: 'x', isActive: true }],
    });

    const result = await applyPlanDefaults(db.prisma as any, {
      START: config('START', 'Start', ['a'], {}),
    });

    expect(db.planFeatures).toHaveLength(2);
    expect(result.drift[0].enabledOutsideDefault).toEqual(['x']);
  });

  it('chave fora do catálogo é relatada, não quebra o seed', async () => {
    const db = memoryDb({ features: ['a'], limits: [] });

    const result = await applyPlanDefaults(db.prisma as any, {
      START: config('START', 'Start', ['a', 'nao_existe'], {}),
    });

    expect(result.unknownFeatureKeys).toEqual(['nao_existe']);
    expect(result.featuresCreated).toBe(1);
  });

  it('um plano que falha não impede os outros', async () => {
    const db = memoryDb({ features: ['a'], limits: [], failOnPlan: 'Start' });

    const result = await applyPlanDefaults(db.prisma as any, {
      START: config('START', 'Start', ['a'], {}),
      LITE: config('LITE', 'Lite', ['a'], {}),
    });

    expect(result.errors).toEqual([{ planType: 'START', message: 'falhou' }]);
    expect(result.plans).toBe(1);
    expect(describePlanDefaultsResult(result)).toContain('1 erros');
  });

  it('não regrava o preço que o painel mudou e preenche o texto da trilha uma vez', async () => {
    const db = memoryDb({
      features: [],
      limits: [],
      existingPlans: [{ name: 'Lite', basePrice: 26000, presentation: null }],
    });
    const lite = config('LITE', 'Lite', [], {});
    lite.presentation = {
      pitch: 'Para quem quer previsibilidade.',
      actions: ['A'],
    };

    const result = await applyPlanDefaults(db.prisma as any, { LITE: lite });

    const plan = db.plans.find((p) => p.name === 'Lite');
    expect(plan.basePrice).toBe(26000);
    expect(plan.presentation).toEqual(lite.presentation);
    expect(result.presentationsFilled).toBe(1);

    plan.presentation = { pitch: 'Editado no painel', actions: [] };
    const again = await applyPlanDefaults(db.prisma as any, { LITE: lite });
    expect(plan.presentation.pitch).toBe('Editado no painel');
    expect(again.presentationsFilled).toBe(0);
  });

  it('no deploy, as chaves novas entram ligadas do plano delas para cima, sem religar o que o painel desligou', async () => {
    const db = memoryDb({
      features: BASE_FEATURES.map((f) => f.key),
      limits: [],
      // O superadmin tinha tirado o controle de caixa do Pro.
      planFeatures: [{ planName: 'Pro', key: 'cash_control', isActive: false }],
    });

    const result = await applyPlanDefaults(
      db.prisma as any,
      PLAN_CONFIGURATIONS as any,
    );

    const plansWith = (key: string) =>
      db.planFeatures
        .filter((r) => r.featureId === `f-${key}` && r.isActive)
        .map((r) => r.planId.replace('p-', ''))
        .sort();
    expect(result.unknownFeatureKeys).toEqual([]);
    expect(plansWith('multiple_companies')).toEqual([
      'Elite',
      'Full',
      'Lite',
      'Pro',
    ]);
    expect(plansWith('transaction_cancel_reasons')).toEqual([
      'Elite',
      'Full',
      'Lite',
      'Pro',
    ]);
    expect(plansWith('cost_base')).toEqual(['Elite', 'Full', 'Pro']);
    expect(plansWith('pricing_center')).toEqual(['Elite', 'Full', 'Pro']);
    expect(plansWith('production_manager')).toEqual(['Elite', 'Full']);
    expect(plansWith('productivity_tracking')).toEqual(['Elite', 'Full']);
    expect(plansWith('stock_control')).toEqual(['Full']);
    expect(plansWith('invoice_entry')).toEqual(['Full']);
    expect(plansWith('can_bill_on_delivery_and_checkout')).toEqual([]);
    expect(plansWith('cash_control')).toEqual(['Elite', 'Full', 'Lite']);
  });

  it('planDefaultsByType indexa o padrão pelo tipo do plano', () => {
    const byType = planDefaultsByType({
      START: config('START', 'Start', ['a', 'a'], { max_users: 3 }),
    });
    expect(byType.get('START')).toEqual({
      features: ['a'],
      limits: { max_users: 3 },
      presentation: null,
    });
  });
});

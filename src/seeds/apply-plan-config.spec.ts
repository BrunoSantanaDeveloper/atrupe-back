import {
  applyPlanDefaults,
  describePlanDefaultsResult,
  planDefaultsByType,
  PlanDefaultsConfig,
} from './apply-plan-config';

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
}) {
  const plans: any[] = [];
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
  return { prisma, planFeatures, planLimits };
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

  it('planDefaultsByType indexa o padrão pelo tipo do plano', () => {
    const byType = planDefaultsByType({
      START: config('START', 'Start', ['a', 'a'], { max_users: 3 }),
    });
    expect(byType.get('START')).toEqual({
      features: ['a'],
      limits: { max_users: 3 },
    });
  });
});

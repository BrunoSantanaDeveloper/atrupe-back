import type { PrismaClient } from '@prisma/client';
import {
  cumulativeViolations,
  isCumulativePlanType,
  isPlanFeatureKey,
} from '../core/plan/plan-feature-rules';

/**
 * Aplica a composição PADRÃO dos planos (src/seeds/plans-complete.ts) sem
 * destruir o que o superadmin configurou.
 *
 * Até 29/09/2026 o seed apagava e recriava `plan_features` e `plan_limits` a
 * cada subida do container — o que tornava impossível configurar um plano
 * pelo painel. Agora ele só CRIA a linha que falta (recurso ou limite novo no
 * código entra ligado, com o valor do código) e nunca toca na existente: o
 * que o superadmin desligou continua desligado; o limite que ele mudou
 * continua mudado. O que diverge do padrão é só relatado (drift).
 *
 * Desde 30/09/2026 o mesmo vale para preço e textos da trilha: o painel os
 * edita, então o seed só os grava na criação do plano (e preenche o texto da
 * trilha uma vez, quando estiver vazio).
 */

export interface PlanDefaultsConfig {
  plan: {
    planType: string;
    name: string;
    description: string;
    basePrice: number;
    additionalUserPrice: number;
    order: number;
    isActive: boolean;
  };
  badge: any;
  concept: any;
  featuresList: any;
  /** Card do plano na trilha de contratação. */
  presentation?: { pitch: string; actions: string[] } | null;
  features: string[];
  limits: Record<string, number>;
}

export interface PlanDrift {
  planType: string;
  /** Ligados no banco e fora do padrão do código. */
  enabledOutsideDefault: string[];
  /** Do padrão do código, mas desligados no banco. */
  disabledFromDefault: string[];
  /** Limites com valor diferente do padrão. */
  limitsChanged: { key: string; value: number; defaultValue: number }[];
}

/** Par de planos vizinhos em que o de cima não tem o que o de baixo tem. */
export interface CumulativeDrift {
  lowerPlan: string;
  higherPlan: string;
  keys: string[];
}

export interface ApplyPlanDefaultsResult {
  plans: number;
  presentationsFilled: number;
  featuresCreated: number;
  limitsCreated: number;
  unknownFeatureKeys: string[];
  unknownLimitKeys: string[];
  drift: PlanDrift[];
  /**
   * Regra cumulativa conferida no banco depois do seed: só relatada, o seed
   * não liga nem desliga nada por ela. Nulo quando não deu para conferir.
   */
  cumulativeViolations: CumulativeDrift[] | null;
  errors: { planType: string; message: string }[];
}

type SeedClient = Pick<
  PrismaClient,
  'plan' | 'feature' | 'limit' | 'planFeature' | 'planLimit'
>;

/** A composição padrão de cada tipo de plano, pelo `planType`. */
export interface PlanDefaults {
  features: string[];
  limits: Record<string, number>;
  presentation: { pitch: string; actions: string[] } | null;
}

export function planDefaultsByType(
  configs: Record<string, PlanDefaultsConfig>,
): Map<string, PlanDefaults> {
  const byType = new Map<string, PlanDefaults>();
  for (const config of Object.values(configs)) {
    byType.set(config.plan.planType, {
      features: [...new Set(config.features)],
      limits: { ...config.limits },
      presentation: config.presentation ?? null,
    });
  }
  return byType;
}

export async function applyPlanDefaults(
  prisma: SeedClient,
  configs: Record<string, PlanDefaultsConfig>,
): Promise<ApplyPlanDefaultsResult> {
  const result: ApplyPlanDefaultsResult = {
    plans: 0,
    presentationsFilled: 0,
    featuresCreated: 0,
    limitsCreated: 0,
    unknownFeatureKeys: [],
    unknownLimitKeys: [],
    drift: [],
    cumulativeViolations: null,
    errors: [],
  };

  for (const config of Object.values(configs)) {
    const planType = config.plan.planType;
    try {
      // Só tipo e ordem vêm do código. Preço, textos, disponibilidade e selo
      // são do painel: o código os define na criação e não os sobrescreve.
      const plan = await prisma.plan.upsert({
        where: { name: config.plan.name },
        update: {
          planType: config.plan.planType as any,
          order: config.plan.order,
        },
        create: {
          ...(config.plan as any),
          badge: config.badge || null,
          concept: config.concept || null,
          features: config.featuresList || null,
          presentation: config.presentation || null,
        },
      });
      result.plans += 1;

      // O texto da trilha chegou depois dos planos: preenche uma vez.
      if (!plan.presentation && config.presentation) {
        await prisma.plan.update({
          where: { id: plan.id },
          data: { presentation: config.presentation as any },
        });
        result.presentationsFilled += 1;
      }

      const defaultKeys = [...new Set(config.features)];
      const catalog = defaultKeys.length
        ? await prisma.feature.findMany({
            where: { key: { in: defaultKeys } },
            select: { id: true, key: true },
          })
        : [];
      for (const key of defaultKeys) {
        const feature = catalog.find((f) => f.key === key);
        if (!feature) {
          if (!result.unknownFeatureKeys.includes(key)) {
            result.unknownFeatureKeys.push(key);
          }
          continue;
        }
        const existing = await prisma.planFeature.findUnique({
          where: {
            planId_featureId: { planId: plan.id, featureId: feature.id },
          },
          select: { id: true },
        });
        if (!existing) {
          await prisma.planFeature.create({
            data: { planId: plan.id, featureId: feature.id, isActive: true },
          });
          result.featuresCreated += 1;
        }
      }

      const limitsChanged: PlanDrift['limitsChanged'] = [];
      for (const [limitKey, defaultValue] of Object.entries(config.limits)) {
        const limit = await prisma.limit.findUnique({
          where: { key: limitKey },
          select: { id: true },
        });
        if (!limit) {
          if (!result.unknownLimitKeys.includes(limitKey)) {
            result.unknownLimitKeys.push(limitKey);
          }
          continue;
        }
        const existing = await prisma.planLimit.findUnique({
          where: { planId_limitId: { planId: plan.id, limitId: limit.id } },
          select: { value: true },
        });
        if (!existing) {
          await prisma.planLimit.create({
            data: {
              planId: plan.id,
              limitId: limit.id,
              value: defaultValue,
              isActive: true,
            },
          });
          result.limitsCreated += 1;
        } else if (existing.value !== defaultValue) {
          limitsChanged.push({
            key: limitKey,
            value: existing.value,
            defaultValue,
          });
        }
      }

      // Recurso aposentado (inativo no catálogo) não conta como diferença.
      const rows = await prisma.planFeature.findMany({
        where: { planId: plan.id, feature: { isActive: true } },
        select: { isActive: true, feature: { select: { key: true } } },
      });
      const enabledOutsideDefault = rows
        .filter((r) => r.isActive && !defaultKeys.includes(r.feature.key))
        .map((r) => r.feature.key)
        .sort();
      const disabledFromDefault = rows
        .filter((r) => !r.isActive && defaultKeys.includes(r.feature.key))
        .map((r) => r.feature.key)
        .sort();
      if (
        enabledOutsideDefault.length ||
        disabledFromDefault.length ||
        limitsChanged.length
      ) {
        result.drift.push({
          planType,
          enabledOutsideDefault,
          disabledFromDefault,
          limitsChanged,
        });
      }
    } catch (error) {
      result.errors.push({
        planType,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Um relatório não derruba o seed: sem conseguir conferir, fica nulo.
  result.cumulativeViolations = await matrixCumulativeViolations(prisma).catch(
    () => null,
  );

  return result;
}

/**
 * A regra cumulativa no banco: planos globais fora o Trial, pela `order`,
 * com as chaves de plano que o código conhece (as que o painel mostra).
 */
async function matrixCumulativeViolations(
  prisma: SeedClient,
): Promise<CumulativeDrift[]> {
  const plans = await prisma.plan.findMany({
    where: { companyId: null },
    orderBy: { order: 'asc' },
    select: { id: true, planType: true, order: true },
  });
  const matrix: {
    plan: { planType: string; order: number };
    keys: string[];
  }[] = [];
  for (const plan of plans) {
    if (!isCumulativePlanType(plan.planType)) continue;
    const rows = await prisma.planFeature.findMany({
      where: { planId: plan.id, feature: { isActive: true } },
      select: { isActive: true, feature: { select: { key: true } } },
    });
    matrix.push({
      plan,
      keys: rows
        .filter((r) => r.isActive && isPlanFeatureKey(r.feature.key))
        .map((r) => r.feature.key),
    });
  }
  return cumulativeViolations(matrix).map((v) => ({
    lowerPlan: v.lowerPlan.planType,
    higherPlan: v.higherPlan.planType,
    keys: v.keys,
  }));
}

/** A linha de resumo que vai para o log do container. */
export function describePlanDefaultsResult(
  result: ApplyPlanDefaultsResult,
): string {
  const drift = result.drift
    .map((d) => {
      const parts: string[] = [];
      if (d.enabledOutsideDefault.length) {
        parts.push(`+${d.enabledOutsideDefault.join(',')}`);
      }
      if (d.disabledFromDefault.length) {
        parts.push(`-${d.disabledFromDefault.join(',')}`);
      }
      for (const l of d.limitsChanged) {
        parts.push(`${l.key}=${l.value} (padrão ${l.defaultValue})`);
      }
      return `${d.planType}[${parts.join(' ')}]`;
    })
    .join(' ');
  const cumulative =
    result.cumulativeViolations === null
      ? 'não conferidas'
      : result.cumulativeViolations.length
        ? result.cumulativeViolations
            .map(
              (v) =>
                `${v.higherPlan} sem ${v.keys.join(',')} (o ${v.lowerPlan} tem)`,
            )
            .join('; ')
        : 'nenhuma';
  return (
    `[seed] planos: ${result.plans} processados, ` +
    `${result.featuresCreated} recursos e ${result.limitsCreated} limites criados, ` +
    (result.presentationsFilled
      ? `${result.presentationsFilled} textos da trilha preenchidos, `
      : '') +
    `${result.errors.length} erros` +
    (result.unknownFeatureKeys.length
      ? `, recursos fora do catálogo: ${result.unknownFeatureKeys.join(',')}`
      : '') +
    (result.unknownLimitKeys.length
      ? `, limites fora do catálogo: ${result.unknownLimitKeys.join(',')}`
      : '') +
    (drift ? `; configurado pelo painel (difere do padrão): ${drift}` : '') +
    `; violações de cumulatividade (só relatadas): ${cumulative}`
  );
}

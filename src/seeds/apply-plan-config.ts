import type { PrismaClient } from '@prisma/client';

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

export interface ApplyPlanDefaultsResult {
  plans: number;
  featuresCreated: number;
  limitsCreated: number;
  unknownFeatureKeys: string[];
  unknownLimitKeys: string[];
  drift: PlanDrift[];
  errors: { planType: string; message: string }[];
}

type SeedClient = Pick<
  PrismaClient,
  'plan' | 'feature' | 'limit' | 'planFeature' | 'planLimit'
>;

/** A composição padrão de cada tipo de plano, pelo `planType`. */
export function planDefaultsByType(
  configs: Record<string, PlanDefaultsConfig>,
): Map<string, { features: string[]; limits: Record<string, number> }> {
  const byType = new Map<
    string,
    { features: string[]; limits: Record<string, number> }
  >();
  for (const config of Object.values(configs)) {
    byType.set(config.plan.planType, {
      features: [...new Set(config.features)],
      limits: { ...config.limits },
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
    featuresCreated: 0,
    limitsCreated: 0,
    unknownFeatureKeys: [],
    unknownLimitKeys: [],
    drift: [],
    errors: [],
  };

  for (const config of Object.values(configs)) {
    const planType = config.plan.planType;
    try {
      // Os dados do plano seguem como antes: nome, preço, ordem e textos vêm
      // do código; disponibilidade (isActive) e selo são do painel e não são
      // sobrescritos.
      const plan = await prisma.plan.upsert({
        where: { name: config.plan.name },
        update: {
          description: config.plan.description,
          basePrice: config.plan.basePrice,
          additionalUserPrice: config.plan.additionalUserPrice,
          planType: config.plan.planType as any,
          order: config.plan.order,
          concept: config.concept || null,
          features: config.featuresList || null,
        },
        create: {
          ...(config.plan as any),
          badge: config.badge || null,
          concept: config.concept || null,
          features: config.featuresList || null,
        },
      });
      result.plans += 1;

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

      const rows = await prisma.planFeature.findMany({
        where: { planId: plan.id },
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

  return result;
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
  return (
    `[seed] planos: ${result.plans} processados, ` +
    `${result.featuresCreated} recursos e ${result.limitsCreated} limites criados, ` +
    `${result.errors.length} erros` +
    (result.unknownFeatureKeys.length
      ? `, recursos fora do catálogo: ${result.unknownFeatureKeys.join(',')}`
      : '') +
    (result.unknownLimitKeys.length
      ? `, limites fora do catálogo: ${result.unknownLimitKeys.join(',')}`
      : '') +
    (drift ? `; configurado pelo painel (difere do padrão): ${drift}` : '')
  );
}

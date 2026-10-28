import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Feature, Plan, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { PLAN_CONFIGURATIONS } from '../../seeds/plans-complete';
import { planDefaultsByType } from '../../seeds/apply-plan-config';
import {
  DEFAULT_PLAN_COMPARISON,
  PlanComparisonGroup,
} from '../../seeds/plan-comparison-base';
import {
  CURRENT_SUBSCRIPTION_STATUSES,
  cumulativeViolations,
  dependentsOf,
  FEATURE_CATEGORY_LABELS,
  FEATURE_CATEGORY_ORDER,
  FEATURE_DEPENDENCIES,
  FEATURE_ENFORCEMENT,
  GRANT_SOURCE,
  isCumulativePlanType,
  isPlanFeatureKey,
  PlanFeatureKey,
} from './plan-feature-rules';
import {
  PlanConfigHistoryQueryDto,
  RestorePlanDefaultsDto,
  SetCompanyFeatureDto,
  SetPlanComparisonDto,
  SetPlanFeatureDto,
  SetPlanLimitDto,
  SetPlanPresentationDto,
  SetPlanPricingDto,
} from './dtos/plan-config.dto';

type Tx = Prisma.TransactionClient;

interface Actor {
  userId: string;
}

interface FeatureChange {
  key: PlanFeatureKey;
  name: string;
  featureId: string;
  enabled: boolean;
  /**
   * Não foi o pedido: entrou por dependência de outra chave ou, num plano de
   * cima, pela regra cumulativa.
   */
  cascade: boolean;
  /** Mudança num plano acima do pedido, pela regra cumulativa. */
  crossPlan: boolean;
}

/** O que um pedido muda num plano. */
interface PlanChanges {
  plan: Plan;
  changes: FeatureChange[];
}

/** O efeito de incluir ou retirar um recurso, na matriz inteira. */
interface MatrixChanges {
  /** As mudanças do plano pedido (podem ser nenhuma). */
  changes: FeatureChange[];
  /** Só os planos com mudança: o pedido primeiro, depois os de cima. */
  plans: PlanChanges[];
  /** Retirada recusada: os planos de baixo que ainda têm o recurso. */
  blockedBy: Plan[] | null;
}

/** Referência de plano nas respostas de erro e na prévia. */
const planRef = (plan: Plan) => ({
  planId: plan.id,
  planName: plan.name,
  planType: plan.planType,
});

const changeView = (change: FeatureChange) => ({
  key: change.key,
  name: change.name,
  enabled: change.enabled,
  cascade: change.cascade,
});

/** Um plano com mudança, na prévia, no 422 de cascata e na resposta. */
export interface PlanChangeView extends ReturnType<typeof planRef> {
  order: number;
  currentSubscriptions: number;
  changes: (ReturnType<typeof changeView> & { crossPlan: boolean })[];
}

const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

/**
 * O que o painel pode mudar em cada limite. `enforced` diz se o sistema de
 * fato verifica o limite hoje (senão o painel avisa que o valor é só
 * informativo).
 */
const LIMIT_RULES: Record<
  string,
  { min: number; allowUnlimited: boolean; enforced: boolean; detail: string }
> = {
  max_users: {
    min: 1,
    allowUnlimited: true,
    enforced: true,
    detail:
      'Verificado ao criar ou reativar usuário. Soma os usuários adicionais contratados.',
  },
  max_companies: {
    min: 1,
    allowUnlimited: true,
    enforced: false,
    detail: 'Ainda não é verificado pelo sistema: o valor é informativo.',
  },
  trial_days: {
    min: 0,
    allowUnlimited: false,
    enforced: true,
    detail: 'Duração dos próximos testes gratuitos (vale para o plano Trial).',
  },
  ai_messages_month: {
    min: 0,
    allowUnlimited: true,
    enforced: true,
    detail:
      'Verificado a cada mensagem ao assistente de IA: soma as mensagens da empresa no mês (a barrada pela proteção não conta). A cota renova no dia 1º.',
  },
};

/** Card do plano na trilha de contratação. */
export interface PlanPresentation {
  pitch: string;
  actions: string[];
}

/** Tabela comparativa da trilha, editada no painel (system_settings). */
const COMPARISON_SETTING_KEY = 'plan_comparison';

const brl = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const DAY_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
});

/**
 * Configuração dos planos pelo superadmin: quais recursos cada plano inclui
 * e os limites de cada um. É a fonte da verdade da composição — o seed só
 * cria o que falta (ver src/seeds/apply-plan-config.ts).
 *
 * Regras de produto (PO, 29/09/2026):
 * - módulos pagos (preço > 0, como a Nota Fiscal) não entram na matriz;
 * - ao RETIRAR um recurso, o superadmin escolhe se atinge as assinaturas
 *   atuais do plano ou só as novas contratações (as atuais o mantêm como
 *   recurso concedido, `grantSource = PLAN_RETAINED`);
 * - a senha gerencial só é pedida quando a alteração atinge assinaturas.
 *
 * Regra cumulativa (10/10/2026): nos planos globais, fora o Trial, cada plano
 * tem tudo o que o anterior tem. Incluir um recurso num plano o leva também
 * aos planos de cima; retirar só vale depois de retirá-lo dos de baixo; o
 * Trial muda sozinho. Restaurar o padrão confere a matriz inteira.
 */
@Injectable()
export class PlanConfigService {
  private readonly logger = new Logger(PlanConfigService.name);
  private readonly defaults = planDefaultsByType(PLAN_CONFIGURATIONS as any);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------

  /** A matriz recurso × plano, os limites e o catálogo, para o painel. */
  async getMatrix() {
    const [plans, catalog, limits] = await Promise.all([
      this.globalPlans(),
      this.matrixCatalog(),
      this.prisma.limit.findMany({ orderBy: { key: 'asc' } }),
    ]);

    const planRows = await Promise.all(
      plans.map(async (plan) => {
        const [featureRows, limitRows, currentSubscriptions] =
          await Promise.all([
            this.prisma.planFeature.findMany({
              where: { planId: plan.id },
              select: { isActive: true, feature: { select: { key: true } } },
            }),
            this.prisma.planLimit.findMany({
              where: { planId: plan.id },
              select: { value: true, limit: { select: { key: true } } },
            }),
            this.countCurrentSubscriptions(plan.id),
          ]);
        const features: Record<string, boolean> = {};
        for (const f of catalog) features[f.key] = false;
        for (const row of featureRows) {
          if (row.feature.key in features) {
            features[row.feature.key] = row.isActive;
          }
        }
        const limitValues: Record<string, number | null> = {};
        for (const l of limits) limitValues[l.key] = null;
        for (const row of limitRows) limitValues[row.limit.key] = row.value;

        const defaults = this.defaults.get(plan.planType);
        return {
          id: plan.id,
          name: plan.name,
          planType: plan.planType,
          order: plan.order,
          isActive: plan.isActive,
          basePrice: plan.basePrice,
          additionalUserPrice: plan.additionalUserPrice ?? 0,
          presentation:
            (plan.presentation as unknown as PlanPresentation | null) ?? null,
          currentSubscriptions,
          features,
          limits: limitValues,
          defaults: {
            features: defaults?.features ?? [],
            limits: defaults?.limits ?? {},
            presentation: defaults?.presentation ?? null,
          },
        };
      }),
    );

    return {
      plans: planRows,
      features: catalog.map((f) => ({
        key: f.key,
        name: f.name,
        description: f.description,
        category: f.category,
        categoryLabel: FEATURE_CATEGORY_LABELS[f.category ?? ''] ?? f.category,
        enforcement: FEATURE_ENFORCEMENT[f.key as PlanFeatureKey],
        dependsOn: FEATURE_DEPENDENCIES[f.key as PlanFeatureKey] ?? [],
        dependents: dependentsOf(f.key),
      })),
      limits: limits.map((l) => ({
        key: l.key,
        name: l.name,
        description: l.description,
        unit: l.unit,
        ...(LIMIT_RULES[l.key] ?? {
          min: 0,
          allowUnlimited: true,
          enforced: false,
          detail: 'Ainda não é verificado pelo sistema: o valor é informativo.',
        }),
      })),
    };
  }

  /** O efeito de incluir ou retirar um recurso, sem alterar nada. */
  async previewFeature(planId: string, featureKey: string, enabled: boolean) {
    const plan = await this.loadPlan(planId);
    const catalog = await this.matrixCatalog();
    const feature = this.catalogFeature(catalog, featureKey);
    const { changes, plans, blockedBy } = await this.matrixChanges(
      plan,
      catalog,
      feature.key,
      enabled,
    );
    const currentSubscriptions = await this.countCurrentSubscriptions(plan.id);
    const keys = changes.map((c) => c.featureId);
    const [retainedGrants, courtesyGrants] = keys.length
      ? await Promise.all([
          this.countGrants(plan.id, keys, GRANT_SOURCE.PLAN_RETAINED),
          this.countGrants(plan.id, keys, GRANT_SOURCE.COURTESY),
        ])
      : [0, 0];
    const planViews = await this.planChangeViews(
      plans,
      plan.id,
      currentSubscriptions,
    );

    return {
      planId: plan.id,
      planName: plan.name,
      planType: plan.planType,
      featureKey: feature.key,
      featureName: feature.name,
      enabled,
      noChange: plans.length === 0,
      // Só as do plano pedido; as de todos os planos estão em `plans`.
      changes: changes.map(changeView),
      requiresCascade: plans.some((p) => p.changes.some((c) => c.cascade)),
      currentSubscriptions,
      // Quem ganha o recurso ao incluir (as assinaturas de todos os planos
      // que mudam), ou quem o perde ao retirar sem manter nas atuais.
      // Retirar mantendo nas atuais não atinge ninguém.
      affectedIfApplied: enabled
        ? sum(planViews.map((p) => p.currentSubscriptions))
        : currentSubscriptions,
      affectedIfKept: 0,
      retainedGrants,
      courtesyGrants,
      requiresChoice: !enabled && currentSubscriptions > 0,
      enforcement: FEATURE_ENFORCEMENT[feature.key as PlanFeatureKey],
      plans: planViews,
      blockedBy: blockedBy ? blockedBy.map(planRef) : null,
    };
  }

  // ---------------------------------------------------------------------
  // Alteração de recursos
  // ---------------------------------------------------------------------

  async setFeature(actor: Actor, planId: string, dto: SetPlanFeatureDto) {
    const plan = await this.loadPlan(planId);
    const catalog = await this.matrixCatalog();
    const feature = this.catalogFeature(catalog, dto.featureKey);
    const { changes, plans, blockedBy } = await this.matrixChanges(
      plan,
      catalog,
      feature.key,
      dto.enabled,
    );

    if (plans.length === 0) {
      return { changed: false, changes: [], affected: 0, plans: [] };
    }
    if (blockedBy) {
      throw new UnprocessableEntityException({
        code: 'LOWER_PLAN_HAS_FEATURE',
        feature: feature.key,
        plans: blockedBy.map(planRef),
        message: `Retire primeiro "${feature.name}" ${this.inPlans(blockedBy, 'do')}.`,
      });
    }

    const current = await this.currentSubscriptionIds(plan.id);
    const planViews = await this.planChangeViews(
      plans,
      plan.id,
      current.length,
    );
    if (plans.some((p) => p.changes.some((c) => c.cascade)) && !dto.cascade) {
      throw new UnprocessableEntityException({
        code: 'DEPENDENCY_REQUIRED',
        message: this.cascadeMessage(feature.name, dto.enabled, plan, plans),
        changes: changes.map(changeView),
        plans: planViews,
      });
    }

    const keepCurrent = this.resolveKeepChoice(
      !dto.enabled,
      current.length,
      dto.keepCurrentSubscriptions,
    );
    // Ao incluir, ganham o recurso as assinaturas atuais de todos os planos
    // que mudam. Ao retirar (só do plano pedido), as do plano, a não ser que
    // o mantenham. A prévia e a senha valem sobre a soma.
    const affectedByPlan = new Map(
      planViews.map((p) => [
        p.planId,
        dto.enabled || !keepCurrent ? p.currentSubscriptions : 0,
      ]),
    );
    const affected = sum(affectedByPlan.values());
    await this.assertPreview(dto.expectedAffected, affected);
    await this.assertPassword(actor, affected, dto.password);

    const actorName = await this.actorName(actor.userId);
    const result = await this.prisma.$transaction(async (tx) => {
      let retainedCreated = 0;
      let retainedRemoved = 0;
      for (const { plan: target, changes: planChanges } of plans) {
        for (const change of planChanges) {
          await tx.planFeature.upsert({
            where: {
              planId_featureId: {
                planId: target.id,
                featureId: change.featureId,
              },
            },
            create: {
              planId: target.id,
              featureId: change.featureId,
              isActive: change.enabled,
            },
            update: { isActive: change.enabled },
          });
        }

        let created = 0;
        let removed = 0;
        if (dto.enabled || !keepCurrent) {
          // Incluído no plano, o recurso mantido fica redundante; retirado de
          // todas, o mantido também sai. A cortesia individual fica.
          removed = await this.removeRetainedGrants(
            tx,
            target.id,
            planChanges.map((c) => c.featureId),
          );
        } else if (current.length > 0) {
          // Retirada: só o plano pedido muda, e as atuais dele o mantêm.
          created = await this.createRetainedGrants(
            tx,
            current,
            planChanges,
            target.name,
            actor.userId,
            actorName,
          );
        }
        retainedCreated += created;
        retainedRemoved += removed;

        const targetSubscriptions =
          planViews.find((p) => p.planId === target.id)?.currentSubscriptions ??
          0;
        for (const change of planChanges) {
          await tx.planConfigHistory.create({
            data: {
              entityType: 'PLAN_FEATURE',
              planId: target.id,
              planType: target.planType,
              featureKey: change.key,
              action: change.enabled ? 'ENABLED' : 'DISABLED',
              description: this.describeFeatureChange(
                target.name,
                change,
                keepCurrent,
                targetSubscriptions,
                { key: feature.key, name: feature.name, planName: plan.name },
              ),
              changes: {
                before: { enabled: !change.enabled },
                after: { enabled: change.enabled },
              },
              metadata: {
                source: dto.source ?? 'PANEL',
                revertOf: dto.revertOf ?? null,
                requestedPlanId: plan.id,
                requestedKey: feature.key,
                cascade: change.cascade,
                crossPlan: change.crossPlan,
                currentSubscriptions: targetSubscriptions,
                affectedSubscriptions: affectedByPlan.get(target.id) ?? 0,
                keepCurrentSubscriptions: dto.enabled ? null : keepCurrent,
                retainedGrantsCreated: created,
                retainedGrantsRemoved: removed,
              },
              createdBy: actor.userId,
              createdByName: actorName,
            },
          });
        }
      }
      return { retainedCreated, retainedRemoved };
    });

    const summary = plans
      .map(
        ({ plan: target, changes: planChanges }) =>
          `${target.name} ${planChanges.map((c) => `${c.enabled ? '+' : '-'}${c.key}`).join(' ')}`,
      )
      .join('; ');
    this.logger.log(
      `Plano ${plan.name}, pedido ${dto.enabled ? '+' : '-'}${feature.key}: ${summary} ` +
        `por ${actorName ?? actor.userId} (${affected} assinaturas atingidas, ` +
        `${result.retainedCreated} mantidas, ${result.retainedRemoved} retenções removidas)`,
    );

    return {
      changed: true,
      // Só as do plano pedido; o que mudou em cada plano está em `plans`.
      changes: changes.map(changeView),
      affected,
      retainedGrantsCreated: result.retainedCreated,
      retainedGrantsRemoved: result.retainedRemoved,
      plans: planViews,
    };
  }

  // ---------------------------------------------------------------------
  // Limites
  // ---------------------------------------------------------------------

  async setLimit(actor: Actor, planId: string, dto: SetPlanLimitDto) {
    const plan = await this.loadPlan(planId);
    const limit = await this.prisma.limit.findUnique({
      where: { key: dto.limitKey },
    });
    if (!limit) {
      throw new NotFoundException('Limite não encontrado.');
    }
    this.assertLimitValue(dto.limitKey, dto.value);

    const existing = await this.prisma.planLimit.findUnique({
      where: { planId_limitId: { planId: plan.id, limitId: limit.id } },
    });
    if (existing && existing.value === dto.value && existing.isActive) {
      return { changed: false, affected: 0 };
    }

    const current = await this.countCurrentSubscriptions(plan.id);
    await this.assertPreview(dto.expectedAffected, current);
    await this.assertPassword(actor, current, dto.password);
    const actorName = await this.actorName(actor.userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.planLimit.upsert({
        where: { planId_limitId: { planId: plan.id, limitId: limit.id } },
        create: {
          planId: plan.id,
          limitId: limit.id,
          value: dto.value,
          isActive: true,
        },
        update: { value: dto.value, isActive: true },
      });
      await tx.planConfigHistory.create({
        data: {
          entityType: 'PLAN_LIMIT',
          planId: plan.id,
          planType: plan.planType,
          limitKey: limit.key,
          action: 'VALUE_CHANGED',
          description: `${limit.name} do plano ${plan.name}: ${this.limitLabel(existing?.value)} → ${this.limitLabel(dto.value)}`,
          changes: {
            before: { value: existing?.value ?? null },
            after: { value: dto.value },
          },
          metadata: {
            source: dto.source ?? 'PANEL',
            revertOf: dto.revertOf ?? null,
            currentSubscriptions: current,
            affectedSubscriptions: current,
          },
          createdBy: actor.userId,
          createdByName: actorName,
        },
      });
    });

    this.logger.log(
      `Plano ${plan.name}: ${limit.key} ${existing?.value ?? '-'} -> ${dto.value} por ${actorName ?? actor.userId}`,
    );
    return { changed: true, affected: current };
  }

  // ---------------------------------------------------------------------
  // Padrão de fábrica
  // ---------------------------------------------------------------------

  /** O que difere do padrão do código neste plano. */
  async defaultsDiff(planId: string) {
    const plan = await this.loadPlan(planId);
    const catalog = await this.matrixCatalog();
    const state = await this.planFeatureState(plan.id, catalog);
    const defaults = this.defaults.get(plan.planType) ?? {
      features: [],
      limits: {},
    };

    const enable = catalog.filter(
      (f) => defaults.features.includes(f.key) && !state.get(f.key),
    );
    const disable = catalog.filter(
      (f) => !defaults.features.includes(f.key) && state.get(f.key),
    );

    const limitRows = await this.prisma.planLimit.findMany({
      where: { planId: plan.id },
      select: { value: true, limit: { select: { key: true, name: true } } },
    });
    const limits = Object.entries(defaults.limits)
      .map(([key, defaultValue]) => {
        const row = limitRows.find((r) => r.limit.key === key);
        return {
          key,
          name: row?.limit.name ?? key,
          value: row?.value ?? null,
          defaultValue,
        };
      })
      .filter((l) => l.value !== l.defaultValue);

    const currentSubscriptions = await this.countCurrentSubscriptions(plan.id);
    return {
      planId: plan.id,
      planName: plan.name,
      planType: plan.planType,
      enable: enable.map((f) => ({ key: f.key, name: f.name })),
      disable: disable.map((f) => ({ key: f.key, name: f.name })),
      limits,
      noChange: !enable.length && !disable.length && !limits.length,
      currentSubscriptions,
      requiresChoice: disable.length > 0 && currentSubscriptions > 0,
    };
  }

  async restoreDefaults(
    actor: Actor,
    planId: string,
    dto: RestorePlanDefaultsDto,
  ) {
    const diff = await this.defaultsDiff(planId);
    if (diff.noChange) return { changed: false, affected: 0 };

    const plan = await this.loadPlan(planId);
    const catalog = await this.matrixCatalog();
    const current = await this.currentSubscriptionIds(plan.id);
    const keepCurrent = this.resolveKeepChoice(
      diff.disable.length > 0,
      current.length,
      dto.keepCurrentSubscriptions,
    );
    const touchesEveryone =
      diff.enable.length > 0 ||
      diff.limits.length > 0 ||
      (diff.disable.length > 0 && !keepCurrent);
    const affected = touchesEveryone ? current.length : 0;
    await this.assertPreview(dto.expectedAffected, affected);
    await this.assertPassword(actor, affected, dto.password);
    const actorName = await this.actorName(actor.userId);

    const toChange = (
      list: { key: string }[],
      enabled: boolean,
    ): FeatureChange[] =>
      list.map((item) => {
        const f = this.catalogFeature(catalog, item.key);
        return {
          key: f.key as PlanFeatureKey,
          name: f.name,
          featureId: f.id,
          enabled,
          cascade: false,
          crossPlan: false,
        };
      });
    const enables = toChange(diff.enable, true);
    const disables = toChange(diff.disable, false);

    await this.prisma.$transaction(async (tx) => {
      for (const change of [...enables, ...disables]) {
        await tx.planFeature.upsert({
          where: {
            planId_featureId: { planId: plan.id, featureId: change.featureId },
          },
          create: {
            planId: plan.id,
            featureId: change.featureId,
            isActive: change.enabled,
          },
          update: { isActive: change.enabled },
        });
      }
      if (enables.length) {
        await this.removeRetainedGrants(
          tx,
          plan.id,
          enables.map((c) => c.featureId),
        );
      }
      if (disables.length) {
        if (keepCurrent && current.length) {
          await this.createRetainedGrants(
            tx,
            current,
            disables,
            plan.name,
            actor.userId,
            actorName,
          );
        } else if (!keepCurrent) {
          await this.removeRetainedGrants(
            tx,
            plan.id,
            disables.map((c) => c.featureId),
          );
        }
      }
      for (const limit of diff.limits) {
        const row = await tx.limit.findUnique({ where: { key: limit.key } });
        if (!row) continue;
        await tx.planLimit.upsert({
          where: { planId_limitId: { planId: plan.id, limitId: row.id } },
          create: {
            planId: plan.id,
            limitId: row.id,
            value: limit.defaultValue,
            isActive: true,
          },
          update: { value: limit.defaultValue, isActive: true },
        });
      }

      const metadata = {
        source: 'RESTORE_DEFAULT',
        currentSubscriptions: current.length,
        affectedSubscriptions: affected,
        keepCurrentSubscriptions: disables.length ? keepCurrent : null,
      };
      for (const change of [...enables, ...disables]) {
        await tx.planConfigHistory.create({
          data: {
            entityType: 'PLAN_FEATURE',
            planId: plan.id,
            planType: plan.planType,
            featureKey: change.key,
            action: change.enabled ? 'ENABLED' : 'DISABLED',
            description: `Padrão restaurado no plano ${plan.name}: "${change.name}" ${change.enabled ? 'incluído' : 'retirado'}${!change.enabled && keepCurrent && current.length ? ' (mantido nas assinaturas atuais)' : ''}`,
            changes: {
              before: { enabled: !change.enabled },
              after: { enabled: change.enabled },
            },
            metadata,
            createdBy: actor.userId,
            createdByName: actorName,
          },
        });
      }
      for (const limit of diff.limits) {
        await tx.planConfigHistory.create({
          data: {
            entityType: 'PLAN_LIMIT',
            planId: plan.id,
            planType: plan.planType,
            limitKey: limit.key,
            action: 'VALUE_CHANGED',
            description: `Padrão restaurado no plano ${plan.name}: ${limit.name} ${this.limitLabel(limit.value)} → ${this.limitLabel(limit.defaultValue)}`,
            changes: {
              before: { value: limit.value },
              after: { value: limit.defaultValue },
            },
            metadata,
            createdBy: actor.userId,
            createdByName: actorName,
          },
        });
      }

      // Regra cumulativa: o padrão de um plano não pode deixar a matriz fora
      // dela. Lançar aqui desfaz a transação inteira (nada fica gravado). O
      // Trial está fora da regra: restaurá-lo não muda a conta.
      if (isCumulativePlanType(plan.planType)) {
        await this.assertCumulative(tx, catalog, plan);
      }
    });

    this.logger.log(
      `Plano ${plan.name}: padrão restaurado por ${actorName ?? actor.userId} ` +
        `(+${enables.length} -${disables.length} recursos, ${diff.limits.length} limites; ${affected} assinaturas atingidas)`,
    );
    return { changed: true, affected };
  }

  // ---------------------------------------------------------------------
  // Histórico
  // ---------------------------------------------------------------------

  async history(query: PlanConfigHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const where: Prisma.PlanConfigHistoryWhereInput = {
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.featureKey
        ? {
            OR: [
              { featureKey: query.featureKey },
              { limitKey: query.featureKey },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.planConfigHistory.count({ where }),
      this.prisma.planConfigHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: items,
      total,
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Registra a troca de disponibilidade feita pelo PlanService, para a
   * trilha ficar num lugar só.
   */
  async recordAvailability(
    actor: Actor,
    plan: { id: string; name: string; planType: string },
    before: boolean,
    after: boolean,
  ) {
    if (before === after) return;
    const actorName = await this.actorName(actor.userId);
    await this.prisma.planConfigHistory.create({
      data: {
        entityType: 'PLAN',
        planId: plan.id,
        planType: plan.planType,
        action: 'AVAILABILITY_CHANGED',
        description: after
          ? `Plano ${plan.name} liberado para contratação`
          : `Plano ${plan.name} retirado da contratação ("Em breve")`,
        changes: { before: { isActive: before }, after: { isActive: after } },
        metadata: { source: 'PANEL' },
        createdBy: actor.userId,
        createdByName: actorName,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Recursos de uma empresa (cortesia)
  // ---------------------------------------------------------------------

  async companyFeatures(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const [subscription, catalog] = await Promise.all([
      this.companySubscription(companyId),
      this.matrixCatalog(),
    ]);
    if (!subscription) {
      return { company, subscription: null, features: [] };
    }

    const [planRows, grants] = await Promise.all([
      this.prisma.planFeature.findMany({
        where: { planId: subscription.planId, isActive: true },
        select: { feature: { select: { key: true } } },
      }),
      this.prisma.subscriptionFeature.findMany({
        where: { subscriptionId: subscription.id },
        include: { feature: { select: { key: true } } },
      }),
    ]);
    const inPlan = new Set(planRows.map((r) => r.feature.key));
    const now = new Date();

    return {
      company,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        planId: subscription.planId,
        planName: subscription.plan.name,
        planType: subscription.plan.planType,
      },
      features: catalog.map((f) => {
        const grant = grants.find((g) => g.feature.key === f.key);
        const grantActive =
          !!grant &&
          grant.isActive &&
          (!grant.expiresAt || grant.expiresAt > now);
        const state = inPlan.has(f.key)
          ? 'PLAN'
          : grantActive
            ? grant.grantSource === GRANT_SOURCE.PLAN_RETAINED
              ? 'RETAINED'
              : 'COURTESY'
            : grant
              ? 'EXPIRED'
              : 'OFF';
        return {
          key: f.key,
          name: f.name,
          category: f.category,
          categoryLabel:
            FEATURE_CATEGORY_LABELS[f.category ?? ''] ?? f.category,
          enforcement: FEATURE_ENFORCEMENT[f.key as PlanFeatureKey],
          state,
          grant: grant
            ? {
                source: grant.grantSource,
                reason: grant.grantReason,
                grantedByName: grant.grantedByName,
                createdAt: grant.createdAt,
                expiresAt: grant.expiresAt,
              }
            : null,
        };
      }),
    };
  }

  async setCompanyFeature(
    actor: Actor,
    companyId: string,
    dto: SetCompanyFeatureDto,
  ) {
    const subscription = await this.companySubscription(companyId);
    if (!subscription) {
      throw new UnprocessableEntityException({
        code: 'NO_SUBSCRIPTION',
        message: 'A empresa não tem assinatura ativa para receber o recurso.',
      });
    }
    const catalog = await this.matrixCatalog();
    const feature = this.catalogFeature(catalog, dto.featureKey);
    const inPlan = await this.prisma.planFeature.findFirst({
      where: {
        planId: subscription.planId,
        featureId: feature.id,
        isActive: true,
      },
      select: { id: true },
    });
    const existing = await this.prisma.subscriptionFeature.findUnique({
      where: {
        subscriptionId_featureId: {
          subscriptionId: subscription.id,
          featureId: feature.id,
        },
      },
    });

    if (dto.enabled) {
      if (inPlan) {
        throw new UnprocessableEntityException({
          code: 'FEATURE_IN_PLAN',
          message: `"${feature.name}" já faz parte do plano ${subscription.plan.name}.`,
        });
      }
      const reason = dto.reason?.trim();
      if (!reason) {
        throw new BadRequestException({
          code: 'REASON_REQUIRED',
          message: 'Informe o motivo da cortesia.',
        });
      }
      const expiresAt = dto.expiresAt ? this.endOfDay(dto.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) {
        throw new BadRequestException({
          code: 'INVALID_EXPIRY',
          message: 'A validade precisa ser uma data futura.',
        });
      }
      // Qualquer alteração aqui atinge uma assinatura em vigor.
      await this.assertPassword(actor, 1, dto.password);
      const actorName = await this.actorName(actor.userId);

      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionFeature.upsert({
          where: {
            subscriptionId_featureId: {
              subscriptionId: subscription.id,
              featureId: feature.id,
            },
          },
          create: {
            subscriptionId: subscription.id,
            featureId: feature.id,
            price: 0,
            isActive: true,
            grantSource: GRANT_SOURCE.COURTESY,
            grantedBy: actor.userId,
            grantedByName: actorName,
            grantReason: reason,
            expiresAt,
          },
          update: {
            price: 0,
            isActive: true,
            grantSource: GRANT_SOURCE.COURTESY,
            grantedBy: actor.userId,
            grantedByName: actorName,
            grantReason: reason,
            expiresAt,
          },
        });
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            action: 'COURTESY_GRANTED',
            description: `Cortesia: "${feature.name}"${expiresAt ? ` até ${DAY_FORMAT.format(expiresAt)}` : ''} — ${reason}`,
            changes: {
              before: existing
                ? {
                    grantSource: existing.grantSource,
                    expiresAt: existing.expiresAt,
                  }
                : null,
              after: { grantSource: GRANT_SOURCE.COURTESY, expiresAt },
            },
            metadata: { featureKey: feature.key },
            createdBy: actor.userId,
            createdByName: actorName,
          },
        });
      });
      return { changed: true };
    }

    if (!existing) {
      if (inPlan) {
        throw new UnprocessableEntityException({
          code: 'FEATURE_IN_PLAN',
          message: `"${feature.name}" faz parte do plano ${subscription.plan.name}: retire-o do plano na matriz.`,
        });
      }
      return { changed: false };
    }
    await this.assertPassword(actor, 1, dto.password);
    const actorName = await this.actorName(actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionFeature.delete({ where: { id: existing.id } });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          action: 'COURTESY_REVOKED',
          description: `Recurso concedido retirado: "${feature.name}"`,
          changes: {
            before: {
              grantSource: existing.grantSource,
              expiresAt: existing.expiresAt,
              reason: existing.grantReason,
            },
            after: null,
          },
          metadata: { featureKey: feature.key },
          createdBy: actor.userId,
          createdByName: actorName,
        },
      });
    });
    return { changed: true };
  }

  // ---------------------------------------------------------------------
  // Preço e textos da trilha
  // ---------------------------------------------------------------------

  /**
   * Mensalidade e usuário adicional do plano. Vale para contratações,
   * evoluções e usuários adicionais comprados daqui em diante; a mensalidade
   * de quem já assina (a cobrança no Asaas) não muda.
   */
  async setPricing(actor: Actor, planId: string, dto: SetPlanPricingDto) {
    const plan = await this.loadPlan(planId);
    if (plan.planType === 'TRIAL') {
      throw new BadRequestException({
        code: 'TRIAL_HAS_NO_PRICE',
        message: 'O Trial não tem preço.',
      });
    }
    if (plan.isActive && dto.basePrice <= 0) {
      throw new BadRequestException({
        code: 'INVALID_PRICE',
        message:
          'Um plano disponível para contratação precisa de mensalidade maior que zero.',
      });
    }

    const before = {
      basePrice: Math.round(plan.basePrice),
      additionalUserPrice: Math.round(plan.additionalUserPrice ?? 0),
    };
    const after = {
      basePrice: dto.basePrice,
      additionalUserPrice: dto.additionalUserPrice,
    };
    if (
      before.basePrice === after.basePrice &&
      before.additionalUserPrice === after.additionalUserPrice
    ) {
      return { changed: false, affected: 0 };
    }

    // Quem já assina não tem a mensalidade alterada, mas passa a pagar o preço
    // novo pelo usuário adicional que comprar: por isso conta como atingido.
    const current = await this.countCurrentSubscriptions(plan.id);
    await this.assertPreview(dto.expectedAffected, current);
    await this.assertPassword(actor, current, dto.password);
    const actorName = await this.actorName(actor.userId);

    const parts: string[] = [];
    if (before.basePrice !== after.basePrice) {
      parts.push(
        `mensalidade de ${brl(before.basePrice)} para ${brl(after.basePrice)}`,
      );
    }
    if (before.additionalUserPrice !== after.additionalUserPrice) {
      parts.push(
        `usuário adicional de ${brl(before.additionalUserPrice)} para ${brl(after.additionalUserPrice)}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.plan.update({ where: { id: plan.id }, data: after });
      await tx.planConfigHistory.create({
        data: {
          entityType: 'PLAN',
          planId: plan.id,
          planType: plan.planType,
          action: 'PRICE_CHANGED',
          description: `Preço do plano ${plan.name}: ${parts.join('; ')}`,
          changes: { before, after },
          metadata: {
            source: dto.source ?? 'PANEL',
            revertOf: dto.revertOf ?? null,
            currentSubscriptions: current,
          },
          createdBy: actor.userId,
          createdByName: actorName,
        },
      });
    });

    this.logger.log(
      `Plano ${plan.name}: ${parts.join('; ')} por ${actorName ?? actor.userId}`,
    );
    return { changed: true, affected: current };
  }

  /** Frase e itens do card do plano na trilha de contratação. */
  async setPresentation(
    actor: Actor,
    planId: string,
    dto: SetPlanPresentationDto,
  ) {
    const plan = await this.loadPlan(planId);
    if (plan.planType === 'TRIAL') {
      throw new BadRequestException({
        code: 'TRIAL_NOT_IN_TRAIL',
        message: 'O Trial não aparece na trilha de contratação.',
      });
    }
    const next: PlanPresentation = {
      pitch: dto.pitch.trim(),
      actions: dto.actions.map((a) => a.trim()).filter(Boolean),
    };
    if (!next.pitch) {
      throw new BadRequestException({
        code: 'PITCH_REQUIRED',
        message: 'Escreva a frase do plano.',
      });
    }
    const before =
      (plan.presentation as unknown as PlanPresentation | null) ?? null;
    if (JSON.stringify(before) === JSON.stringify(next)) {
      return { changed: false };
    }

    const actorName = await this.actorName(actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id: plan.id },
        data: { presentation: next as any },
      });
      await tx.planConfigHistory.create({
        data: {
          entityType: 'PLAN',
          planId: plan.id,
          planType: plan.planType,
          action: 'PRESENTATION_CHANGED',
          description: `Textos da trilha do plano ${plan.name} alterados`,
          changes: { before, after: next } as any,
          metadata: { source: 'PANEL' },
          createdBy: actor.userId,
          createdByName: actorName,
        },
      });
    });
    return { changed: true };
  }

  /** A tabela "Compare todos os planos" da trilha: a salva ou o padrão. */
  async getComparison() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: COMPARISON_SETTING_KEY },
    });
    const stored = (setting?.value as { groups?: PlanComparisonGroup[] } | null)
      ?.groups;
    const valid = Array.isArray(stored) && stored.length > 0;
    return {
      groups: valid ? stored : DEFAULT_PLAN_COMPARISON,
      isDefault: !valid,
      defaults: DEFAULT_PLAN_COMPARISON,
    };
  }

  async setComparison(actor: Actor, dto: SetPlanComparisonDto) {
    const groups: PlanComparisonGroup[] = dto.groups
      .map((g) => ({
        group: g.group.trim(),
        rows: g.rows
          .map((r) => ({ label: r.label.trim(), since: r.since }))
          .filter((r) => r.label),
      }))
      .filter((g) => g.group && g.rows.length > 0);
    if (groups.length === 0) {
      throw new BadRequestException({
        code: 'COMPARISON_EMPTY',
        message: 'A tabela precisa de ao menos um grupo com uma linha.',
      });
    }

    const current = await this.getComparison();
    if (JSON.stringify(current.groups) === JSON.stringify(groups)) {
      return { changed: false };
    }
    const actorName = await this.actorName(actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: COMPARISON_SETTING_KEY },
        create: { key: COMPARISON_SETTING_KEY, value: { groups } as any },
        update: { value: { groups } as any },
      });
      await tx.planConfigHistory.create({
        data: {
          entityType: 'COMPARISON',
          action: 'COMPARISON_CHANGED',
          description: 'Tabela comparativa dos planos alterada',
          changes: { before: current.groups, after: groups } as any,
          metadata: { source: 'PANEL' },
          createdBy: actor.userId,
          createdByName: actorName,
        },
      });
    });
    return { changed: true };
  }

  // ---------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------

  private globalPlans() {
    return this.prisma.plan.findMany({
      where: { companyId: null },
      orderBy: { order: 'asc' },
    });
  }

  private async loadPlan(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.companyId) {
      throw new NotFoundException('Plano não encontrado.');
    }
    return plan;
  }

  /**
   * Recursos da matriz: os de plano (preço zero) que o código conhece.
   * Módulos pagos ficam fora por decisão do PO; chaves antigas que o código
   * não usa mais também (não mudariam nada).
   */
  private async matrixCatalog() {
    const features = await this.prisma.feature.findMany({
      where: { isActive: true, price: { lte: 0 } },
    });
    return features
      .filter((f) => isPlanFeatureKey(f.key))
      .sort((a, b) => {
        const ca = FEATURE_CATEGORY_ORDER.indexOf(a.category ?? '');
        const cb = FEATURE_CATEGORY_ORDER.indexOf(b.category ?? '');
        const ia = ca < 0 ? FEATURE_CATEGORY_ORDER.length : ca;
        const ib = cb < 0 ? FEATURE_CATEGORY_ORDER.length : cb;
        return ia - ib || a.name.localeCompare(b.name, 'pt-BR');
      });
  }

  private catalogFeature(
    catalog: Awaited<ReturnType<PlanConfigService['matrixCatalog']>>,
    key: string,
  ) {
    const feature = catalog.find((f) => f.key === key);
    if (!feature) {
      throw new BadRequestException({
        code: 'FEATURE_NOT_CONFIGURABLE',
        message:
          'Este recurso não é configurável por plano (módulo pago ou fora do catálogo).',
      });
    }
    return feature;
  }

  private async planFeatureState(
    planId: string,
    catalog: Awaited<ReturnType<PlanConfigService['matrixCatalog']>>,
    client: Pick<Tx, 'planFeature'> = this.prisma,
  ) {
    const rows = await client.planFeature.findMany({
      where: { planId },
      select: { isActive: true, feature: { select: { key: true } } },
    });
    const state = new Map<string, boolean>();
    for (const f of catalog) state.set(f.key, false);
    for (const row of rows) {
      if (state.has(row.feature.key)) state.set(row.feature.key, row.isActive);
    }
    return state;
  }

  /**
   * As mudanças que o pedido provoca na matriz.
   *
   * Incluir: no plano pedido, o recurso e o que ele exige (o que faltar); pela
   * regra cumulativa, o mesmo em cada plano de cima que não o tenha. Retirar:
   * o recurso e o que depende dele, só no plano pedido — e recusado enquanto
   * um plano de baixo o tiver. O Trial está fora da regra e muda sozinho.
   */
  private async matrixChanges(
    plan: Plan,
    catalog: Feature[],
    key: string,
    enabled: boolean,
  ): Promise<MatrixChanges> {
    const state = await this.planFeatureState(plan.id, catalog);
    const chain = isCumulativePlanType(plan.planType)
      ? (await this.globalPlans()).filter((p) =>
          isCumulativePlanType(p.planType),
        )
      : [];

    if (enabled) {
      const changes = this.inclusionChanges(catalog, state, key, false);
      const plans: PlanChanges[] = changes.length ? [{ plan, changes }] : [];
      for (const above of chain.filter((p) => p.order > plan.order)) {
        const aboveState = await this.planFeatureState(above.id, catalog);
        const aboveChanges = this.inclusionChanges(
          catalog,
          aboveState,
          key,
          true,
        );
        if (aboveChanges.length) {
          plans.push({ plan: above, changes: aboveChanges });
        }
      }
      return { changes, plans, blockedBy: null };
    }

    const changes = this.computeChanges(catalog, state, key, false);
    if (changes.length === 0) {
      return { changes, plans: [], blockedBy: null };
    }
    const blockedBy: Plan[] = [];
    for (const below of chain.filter((p) => p.order < plan.order)) {
      const belowState = await this.planFeatureState(below.id, catalog);
      if (changes.some((c) => belowState.get(c.key))) blockedBy.push(below);
    }
    return {
      changes,
      plans: [{ plan, changes }],
      blockedBy: blockedBy.length ? blockedBy : null,
    };
  }

  /**
   * Ao incluir: o recurso e tudo o que ele exige, o que faltar no plano. Num
   * plano de cima (`crossPlan`), tudo entra como cascata.
   */
  private inclusionChanges(
    catalog: Feature[],
    state: Map<string, boolean>,
    key: string,
    crossPlan: boolean,
  ): FeatureChange[] {
    const byKey = new Map(catalog.map((f) => [f.key, f]));
    const changes: FeatureChange[] = [];
    const seen = new Set<string>();
    const visit = (k: string) => {
      const f = byKey.get(k);
      if (!f || seen.has(k)) return;
      seen.add(k);
      if (!state.get(k)) {
        changes.push({
          key: k as PlanFeatureKey,
          name: f.name,
          featureId: f.id,
          enabled: true,
          cascade: crossPlan || k !== key,
          crossPlan,
        });
      }
      // Segue pelas dependências mesmo de um recurso já ligado: o plano de
      // cima precisa ter tudo o que o de baixo vai ter.
      for (const dep of FEATURE_DEPENDENCIES[k as PlanFeatureKey] ?? []) {
        visit(dep);
      }
    };
    visit(key);
    return changes;
  }

  /**
   * As mudanças dentro de um plano: o próprio recurso e, por dependência, o
   * que ele exige (ao incluir) ou o que depende dele (ao retirar).
   */
  private computeChanges(
    catalog: Awaited<ReturnType<PlanConfigService['matrixCatalog']>>,
    state: Map<string, boolean>,
    key: string,
    enabled: boolean,
  ): FeatureChange[] {
    const byKey = new Map(catalog.map((f) => [f.key, f]));
    const changes: FeatureChange[] = [];
    const visit = (k: string, cascade: boolean) => {
      const f = byKey.get(k);
      if (!f || state.get(k) === enabled) return;
      if (changes.some((c) => c.key === k)) return;
      changes.push({
        key: k as PlanFeatureKey,
        name: f.name,
        featureId: f.id,
        enabled,
        cascade,
        crossPlan: false,
      });
      const next = enabled
        ? (FEATURE_DEPENDENCIES[k as PlanFeatureKey] ?? [])
        : dependentsOf(k);
      for (const n of next) visit(n, true);
    };
    visit(key, false);
    return changes;
  }

  /** Cada plano com mudança, com as assinaturas atuais dele (formato da prévia). */
  private async planChangeViews(
    plans: PlanChanges[],
    requestedPlanId: string,
    requestedSubscriptions: number,
  ): Promise<PlanChangeView[]> {
    const views: PlanChangeView[] = [];
    for (const { plan, changes } of plans) {
      views.push({
        ...planRef(plan),
        order: plan.order,
        currentSubscriptions:
          plan.id === requestedPlanId
            ? requestedSubscriptions
            : await this.countCurrentSubscriptions(plan.id),
        changes: changes.map((c) => ({
          ...changeView(c),
          crossPlan: c.crossPlan,
        })),
      });
    }
    return views;
  }

  /**
   * Confere a regra cumulativa na matriz inteira, lida dentro da transação
   * (já com o que ela gravou). Fora da regra, recusa com 422 — o que desfaz a
   * transação.
   */
  private async assertCumulative(tx: Tx, catalog: Feature[], restored: Plan) {
    const plans = await tx.plan.findMany({
      where: { companyId: null },
      orderBy: { order: 'asc' },
    });
    const matrix: { plan: Plan; keys: string[] }[] = [];
    for (const plan of plans.filter((p) => isCumulativePlanType(p.planType))) {
      const state = await this.planFeatureState(plan.id, catalog, tx);
      matrix.push({
        plan,
        keys: [...state].filter(([, on]) => on).map(([key]) => key),
      });
    }
    const violations = cumulativeViolations(matrix);
    if (violations.length === 0) return;

    const name = (key: string) =>
      `"${catalog.find((f) => f.key === key)?.name ?? key}"`;
    const detail = violations
      .map(
        (v) =>
          `o ${v.higherPlan.name} não tem ${v.keys.map(name).join(', ')}, que o ${v.lowerPlan.name} tem`,
      )
      .join('; ');
    throw new UnprocessableEntityException({
      code: 'NOT_CUMULATIVE',
      violations: violations.map((v) => ({
        lowerPlan: planRef(v.lowerPlan),
        higherPlan: planRef(v.higherPlan),
        keys: v.keys,
      })),
      message: `Restaurar o padrão do plano ${restored.name} deixaria a matriz fora da regra cumulativa: ${detail}. Nada foi alterado.`,
    });
  }

  /** O 422 de cascata: as dependências no plano e os planos de cima. */
  private cascadeMessage(
    featureName: string,
    enabled: boolean,
    requested: Plan,
    plans: PlanChanges[],
  ) {
    const own =
      plans
        .find((p) => p.plan.id === requested.id)
        ?.changes.filter((c) => c.cascade) ?? [];
    const above = plans
      .filter((p) => p.plan.id !== requested.id)
      .map((p) => p.plan);
    const parts: string[] = [];
    if (own.length) {
      parts.push(
        enabled
          ? `Para incluir "${featureName}", inclua também: ${this.names(own)}.`
          : `Para retirar "${featureName}", retire também: ${this.names(own)}.`,
      );
    }
    if (above.length) {
      parts.push(
        `Pela regra cumulativa, "${featureName}" também entra ${this.inPlans(above, 'no')}.`,
      );
    }
    return parts.join(' ');
  }

  /** "no plano Pro" / "nos planos Pro, Elite e Full" (ou "do"/"dos"). */
  private inPlans(plans: Plan[], preposition: 'no' | 'do') {
    const names = plans.map((p) => p.name);
    const list =
      names.length > 1
        ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
        : names[0];
    return names.length > 1
      ? `${preposition}s planos ${list}`
      : `${preposition} plano ${list}`;
  }

  private resolveKeepChoice(
    removing: boolean,
    currentCount: number,
    choice: boolean | undefined,
  ): boolean {
    if (!removing || currentCount === 0) return false;
    if (choice === undefined || choice === null) {
      throw new UnprocessableEntityException({
        code: 'CHOICE_REQUIRED',
        message:
          'Informe se a retirada atinge as assinaturas atuais do plano ou só as novas contratações.',
      });
    }
    return choice;
  }

  private async assertPreview(expected: number | undefined, actual: number) {
    if (expected !== undefined && expected !== null && expected !== actual) {
      throw new ConflictException({
        code: 'PREVIEW_CHANGED',
        message: `O número de assinaturas atingidas mudou (${expected} → ${actual}). Confira de novo antes de confirmar.`,
        affected: actual,
      });
    }
  }

  /** Senha gerencial: só quando a alteração atinge assinaturas. */
  private async assertPassword(
    actor: Actor,
    affected: number,
    password: string | undefined,
  ) {
    if (affected <= 0) return;
    if (!password) {
      throw new UnauthorizedException({
        code: 'PASSWORD_REQUIRED',
        message:
          'Esta alteração atinge assinaturas: confirme com a senha gerencial.',
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { password: true },
    });
    const valid =
      !!user?.password &&
      (await argon2.verify(user.password, password).catch(() => false));
    if (!valid) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Senha do administrador incorreta.',
      });
    }
  }

  private async actorName(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? null;
  }

  private currentSubscriptionWhere(planId: string) {
    return {
      planId,
      status: { in: [...CURRENT_SUBSCRIPTION_STATUSES] },
      NOT: { asaasSubscriptionId: { startsWith: 'temp_' } },
    } satisfies Prisma.SubscriptionWhereInput;
  }

  private countCurrentSubscriptions(planId: string) {
    return this.prisma.subscription.count({
      where: this.currentSubscriptionWhere(planId),
    });
  }

  private async currentSubscriptionIds(planId: string) {
    const rows = await this.prisma.subscription.findMany({
      where: this.currentSubscriptionWhere(planId),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private countGrants(planId: string, featureIds: string[], source: string) {
    return this.prisma.subscriptionFeature.count({
      where: {
        featureId: { in: featureIds },
        grantSource: source,
        subscription: this.currentSubscriptionWhere(planId),
      },
    });
  }

  private async removeRetainedGrants(
    tx: Tx,
    planId: string,
    featureIds: string[],
  ) {
    const removed = await tx.subscriptionFeature.deleteMany({
      where: {
        featureId: { in: featureIds },
        grantSource: GRANT_SOURCE.PLAN_RETAINED,
        subscription: { planId },
      },
    });
    return removed.count;
  }

  private async createRetainedGrants(
    tx: Tx,
    subscriptionIds: string[],
    changes: FeatureChange[],
    planName: string,
    actorId: string,
    actorName: string | null,
  ) {
    const day = DAY_FORMAT.format(new Date());
    const data: Prisma.SubscriptionFeatureCreateManyInput[] = [];
    for (const subscriptionId of subscriptionIds) {
      for (const change of changes) {
        data.push({
          subscriptionId,
          featureId: change.featureId,
          price: 0,
          isActive: true,
          grantSource: GRANT_SOURCE.PLAN_RETAINED,
          grantedBy: actorId,
          grantedByName: actorName,
          grantReason: `Mantido ao retirar "${change.name}" do plano ${planName} em ${day}`,
        });
      }
    }
    // A linha que já existe (módulo contratado ou cortesia) fica como está.
    const created = await tx.subscriptionFeature.createMany({
      data,
      skipDuplicates: true,
    });
    return created.count;
  }

  /**
   * A assinatura em que a cortesia se apoia: a ativa (a paga antes do
   * teste, como no plano da sessão) ou, sem ativa, a bloqueada.
   */
  private async companySubscription(companyId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        companyId,
        status: { in: [...CURRENT_SUBSCRIPTION_STATUSES] },
        NOT: { asaasSubscriptionId: { startsWith: 'temp_' } },
      },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    const active = subs.filter((s) => s.status === 'ACTIVE');
    return (
      active.find((s) => s.plan.planType !== 'TRIAL') ??
      active[0] ??
      subs[0] ??
      null
    );
  }

  private describeFeatureChange(
    planName: string,
    change: FeatureChange,
    keepCurrent: boolean,
    currentCount: number,
    requested: { key: string; name: string; planName: string },
  ) {
    const verb = change.enabled ? 'incluído no' : 'retirado do';
    const scope = change.enabled
      ? ''
      : currentCount === 0
        ? ''
        : keepCurrent
          ? ' (mantido nas assinaturas atuais; vale para novas contratações)'
          : ' (retirado também das assinaturas atuais)';
    const reasons: string[] = [];
    if (change.key !== requested.key) {
      reasons.push(`por dependência de "${requested.name}"`);
    }
    if (change.crossPlan) {
      reasons.push(
        `pela regra cumulativa, ao incluir "${requested.name}" no plano ${requested.planName}`,
      );
    }
    const why = reasons.length ? ` — ${reasons.join('; ')}` : '';
    return `"${change.name}" ${verb} plano ${planName}${scope}${why}`;
  }

  private assertLimitValue(key: string, value: number) {
    const rule = LIMIT_RULES[key];
    if (!rule) return;
    if (value === -1) {
      if (!rule.allowUnlimited) {
        throw new BadRequestException({
          code: 'INVALID_LIMIT',
          message: 'Este limite não aceita "ilimitado".',
        });
      }
      return;
    }
    if (value < rule.min) {
      throw new BadRequestException({
        code: 'INVALID_LIMIT',
        message: `O valor mínimo deste limite é ${rule.min}.`,
      });
    }
  }

  private limitLabel(value: number | null | undefined) {
    if (value === null || value === undefined) return 'sem valor';
    return value === -1 ? 'ilimitado' : String(value);
  }

  private names(changes: FeatureChange[]) {
    return changes.map((c) => `"${c.name}"`).join(', ');
  }

  /** Fim do dia informado, no horário de Brasília. */
  private endOfDay(date: string) {
    const day = date.slice(0, 10);
    return new Date(`${day}T23:59:59.999-03:00`);
  }
}

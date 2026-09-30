import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  dependentsOf,
  FEATURE_CATEGORY_LABELS,
  FEATURE_CATEGORY_ORDER,
  FEATURE_DEPENDENCIES,
  FEATURE_ENFORCEMENT,
  GRANT_SOURCE,
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
  /** Entrou por dependência de outra chave, não pelo pedido. */
  cascade: boolean;
}

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
    const state = await this.planFeatureState(plan.id, catalog);
    const changes = this.computeChanges(catalog, state, feature.key, enabled);
    const currentSubscriptions = await this.countCurrentSubscriptions(plan.id);
    const keys = changes.map((c) => c.featureId);
    const [retainedGrants, courtesyGrants] = keys.length
      ? await Promise.all([
          this.countGrants(plan.id, keys, GRANT_SOURCE.PLAN_RETAINED),
          this.countGrants(plan.id, keys, GRANT_SOURCE.COURTESY),
        ])
      : [0, 0];

    return {
      planId: plan.id,
      planName: plan.name,
      planType: plan.planType,
      featureKey: feature.key,
      featureName: feature.name,
      enabled,
      noChange: changes.length === 0,
      changes: changes.map((c) => ({
        key: c.key,
        name: c.name,
        enabled: c.enabled,
        cascade: c.cascade,
      })),
      requiresCascade: changes.some((c) => c.cascade),
      currentSubscriptions,
      // Quem perde o recurso ao retirar sem manter nas atuais, ou quem o
      // ganha ao incluir. Retirar mantendo nas atuais não atinge ninguém.
      affectedIfApplied: currentSubscriptions,
      affectedIfKept: 0,
      retainedGrants,
      courtesyGrants,
      requiresChoice: !enabled && currentSubscriptions > 0,
      enforcement: FEATURE_ENFORCEMENT[feature.key as PlanFeatureKey],
    };
  }

  // ---------------------------------------------------------------------
  // Alteração de recursos
  // ---------------------------------------------------------------------

  async setFeature(actor: Actor, planId: string, dto: SetPlanFeatureDto) {
    const plan = await this.loadPlan(planId);
    const catalog = await this.matrixCatalog();
    const feature = this.catalogFeature(catalog, dto.featureKey);
    const state = await this.planFeatureState(plan.id, catalog);
    const changes = this.computeChanges(
      catalog,
      state,
      feature.key,
      dto.enabled,
    );

    if (changes.length === 0) {
      return { changed: false, changes: [], affected: 0 };
    }
    if (changes.some((c) => c.cascade) && !dto.cascade) {
      throw new UnprocessableEntityException({
        code: 'DEPENDENCY_REQUIRED',
        message: dto.enabled
          ? `Para incluir "${feature.name}", inclua também: ${this.names(changes.filter((c) => c.cascade))}.`
          : `Para retirar "${feature.name}", retire também: ${this.names(changes.filter((c) => c.cascade))}.`,
        changes: changes.map((c) => ({
          key: c.key,
          name: c.name,
          enabled: c.enabled,
          cascade: c.cascade,
        })),
      });
    }

    const current = await this.currentSubscriptionIds(plan.id);
    const keepCurrent = this.resolveKeepChoice(
      !dto.enabled,
      current.length,
      dto.keepCurrentSubscriptions,
    );
    const affected = dto.enabled || !keepCurrent ? current.length : 0;
    await this.assertPreview(dto.expectedAffected, affected);
    await this.assertPassword(actor, affected, dto.password);

    const actorName = await this.actorName(actor.userId);
    const featureIds = changes.map((c) => c.featureId);
    const result = await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
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

      let retainedCreated = 0;
      let retainedRemoved = 0;
      if (dto.enabled || !keepCurrent) {
        // Incluído no plano, o recurso mantido fica redundante; retirado de
        // todas, o mantido também sai. A cortesia individual fica.
        retainedRemoved = await this.removeRetainedGrants(
          tx,
          plan.id,
          featureIds,
        );
      } else if (current.length > 0) {
        retainedCreated = await this.createRetainedGrants(
          tx,
          current,
          changes,
          plan.name,
          actor.userId,
          actorName,
        );
      }

      for (const change of changes) {
        await tx.planConfigHistory.create({
          data: {
            entityType: 'PLAN_FEATURE',
            planId: plan.id,
            planType: plan.planType,
            featureKey: change.key,
            action: change.enabled ? 'ENABLED' : 'DISABLED',
            description: this.describeFeatureChange(
              plan.name,
              change,
              keepCurrent,
              current.length,
              feature.name,
            ),
            changes: {
              before: { enabled: !change.enabled },
              after: { enabled: change.enabled },
            },
            metadata: {
              source: dto.source ?? 'PANEL',
              revertOf: dto.revertOf ?? null,
              requestedKey: feature.key,
              cascade: change.cascade,
              currentSubscriptions: current.length,
              affectedSubscriptions: affected,
              keepCurrentSubscriptions: dto.enabled ? null : keepCurrent,
              retainedGrantsCreated: retainedCreated,
              retainedGrantsRemoved: retainedRemoved,
            },
            createdBy: actor.userId,
            createdByName: actorName,
          },
        });
      }
      return { retainedCreated, retainedRemoved };
    });

    this.logger.log(
      `Plano ${plan.name}: ${changes.map((c) => `${c.enabled ? '+' : '-'}${c.key}`).join(' ')} ` +
        `por ${actorName ?? actor.userId} (${affected} assinaturas atingidas, ` +
        `${result.retainedCreated} mantidas, ${result.retainedRemoved} retenções removidas)`,
    );

    return {
      changed: true,
      changes: changes.map((c) => ({
        key: c.key,
        name: c.name,
        enabled: c.enabled,
        cascade: c.cascade,
      })),
      affected,
      retainedGrantsCreated: result.retainedCreated,
      retainedGrantsRemoved: result.retainedRemoved,
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
  ) {
    const rows = await this.prisma.planFeature.findMany({
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
   * As mudanças que o pedido provoca: o próprio recurso e, por dependência,
   * o que ele exige (ao incluir) ou o que depende dele (ao retirar).
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
      });
      const next = enabled
        ? (FEATURE_DEPENDENCIES[k as PlanFeatureKey] ?? [])
        : dependentsOf(k);
      for (const n of next) visit(n, true);
    };
    visit(key, false);
    return changes;
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
    requestedName: string,
  ) {
    const verb = change.enabled ? 'incluído no' : 'retirado do';
    const scope = change.enabled
      ? ''
      : currentCount === 0
        ? ''
        : keepCurrent
          ? ' (mantido nas assinaturas atuais; vale para novas contratações)'
          : ' (retirado também das assinaturas atuais)';
    const cascade = change.cascade
      ? ` — por dependência de "${requestedName}"`
      : '';
    return `"${change.name}" ${verb} plano ${planName}${scope}${cascade}`;
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

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { aiUsageMonth } from '../ai/ai-usage-month';

export interface CompanyLimits {
  [key: string]: number; // Sistema dinâmico - qualquer limite
}

interface CompanyFeatures {
  [key: string]: boolean;
}

interface PlanInfo {
  planId: string;
  planType: string;
  planName: string;
  features: CompanyFeatures;
  limits: CompanyLimits;
  additionalUsers: number;
  isTrialActive: boolean;
  trialEndsAt?: Date | null;
}

/** Corpo do 403 de recurso fora do plano: a tela reconhece pelo `code`. */
export const FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE';
export const PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED';

/** O plano a partir do qual um recurso está disponível. */
export interface AvailableFrom {
  planType: string;
  name: string;
  /** Se o plano pode ser contratado hoje. */
  isActive: boolean;
}

/** De qual plano em diante um recurso está disponível (403 e mapa público). */
export interface FeatureAvailability {
  key: string;
  name: string;
  category: string | null;
  availableFrom: AvailableFrom | null;
  /** Módulo contratado à parte (preço no catálogo): não vem com plano. */
  module: boolean;
}

@Injectable()
export class PlanControlService {
  constructor(private prisma: PrismaService) {}

  /**
   * Buscar informações de um limite pelo key (SISTEMA DINÂMICO)
   */
  private async getLimitInfo(limitKey: string) {
    return this.prisma.limit.findUnique({
      where: { key: limitKey },
      select: { name: true, description: true, unit: true },
    });
  }

  /**
   * Obter informações completas do plano da empresa.
   *
   * Um recurso vale para a empresa quando:
   * - o plano da assinatura o inclui (`plan_features.isActive`) — é o que o
   *   superadmin liga e desliga no painel; ou
   * - a assinatura o tem à parte (`subscription_features.isActive`): módulo
   *   contratado, recurso mantido ao sair do plano ou cortesia — esta, só
   *   dentro da validade.
   * Recurso desativado no catálogo (`features.isActive`) não vale para ninguém.
   */
  async getCompanyPlanInfo(companyId: string): Promise<PlanInfo | null> {
    const now = new Date();
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        Subscription: {
          where: {
            status: 'ACTIVE',
          },
          select: {
            id: true,
            additionalUsers: true,
            nextDueDate: true,
            plan: {
              select: {
                id: true,
                name: true,
                planType: true,
                planFeatures: {
                  where: { isActive: true, feature: { isActive: true } },
                  include: {
                    feature: true,
                  },
                },
                planLimits: {
                  where: { isActive: true },
                  include: {
                    limit: true,
                  },
                },
              },
            },
            subscriptionFeatures: {
              where: {
                isActive: true,
                feature: { isActive: true },
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              include: {
                feature: true,
              },
            },
          },
        },
      },
    });

    if (!company) {
      throw new BadRequestException('Empresa não encontrada');
    }

    // Com um trial ACTIVE e uma assinatura paga ACTIVE ao mesmo tempo, pegar o
    // [0] era sorteio da ordem do banco — e o plano da sessão saía errado.
    // A assinatura paga manda; o trial só vale quando é a única.
    const subscription =
      company.Subscription.find((s) => s.plan?.planType !== 'TRIAL') ??
      company.Subscription[0];
    if (!subscription) {
      return null;
    }

    const plan = subscription.plan;

    // Processar features (do plano + adicionais da subscription)
    const features: CompanyFeatures = {};

    // Features do plano
    plan.planFeatures.forEach((pf) => {
      if (pf.feature?.key) {
        features[pf.feature.key] = true;
      }
    });

    // Features adicionais da subscription
    subscription.subscriptionFeatures.forEach((sf) => {
      if (sf.isActive && sf.feature?.key) {
        features[sf.feature.key] = true;
      }
    });

    // Processar limits (SISTEMA DINÂMICO)
    const limits: CompanyLimits = {};

    plan.planLimits.forEach((pl) => {
      if (pl.limit?.key) {
        const limitKey = pl.limit.key;
        let value = pl.value;

        // Adicionar usuários extras para o limite de usuários
        if (
          limitKey === 'max_users' &&
          value !== -1 &&
          subscription.additionalUsers > 0
        ) {
          value += subscription.additionalUsers;
        }

        // Adicionar limite dinamicamente (sem switch/case hardcoded)
        limits[limitKey] = value;
      }
    });

    // Verificar se trial está ativo através da subscription
    const isTrialActive =
      plan.planType === 'TRIAL' &&
      subscription.nextDueDate &&
      subscription.nextDueDate > new Date();

    return {
      planId: plan.id,
      planType: plan.planType,
      planName: plan.name,
      features,
      limits,
      additionalUsers: subscription.additionalUsers,
      isTrialActive: !!isTrialActive,
      trialEndsAt: plan.planType === 'TRIAL' ? subscription.nextDueDate : null,
    };
  }

  /**
   * Verificar se empresa tem uma feature específica. Com uma lista, basta
   * ter uma delas.
   */
  async hasFeature(
    companyId: string,
    featureKey: string | string[],
  ): Promise<boolean> {
    const planInfo = await this.getCompanyPlanInfo(companyId);
    return this.includesAny(planInfo, featureKey);
  }

  private includesAny(
    planInfo: PlanInfo | null,
    featureKey: string | string[],
  ) {
    if (!planInfo) return false;
    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
    return keys.some((key) => !!planInfo.features[key]);
  }

  /**
   * Verificar se empresa está dentro do limite para um recurso
   */
  async checkLimit(
    companyId: string,
    limitKey: string,
    currentUsage: number,
  ): Promise<boolean> {
    const planInfo = await this.getCompanyPlanInfo(companyId);
    return this.withinLimit(planInfo, limitKey, currentUsage);
  }

  private withinLimit(
    planInfo: PlanInfo | null,
    limitKey: string,
    currentUsage: number,
  ): boolean {
    if (!planInfo) return false;

    // Sistema dinâmico - buscar limite pelo key
    const limit = planInfo.limits[limitKey];

    // Se limite não existe, permitir
    if (limit === undefined) {
      return true;
    }

    // -1 significa ilimitado
    if (limit === -1) return true;

    return currentUsage <= limit;
  }

  /**
   * Enforçar limite - lança exceção se excedido. `currentUsage` é o uso
   * DEPOIS da ação (quem cria passa o atual + 1).
   */
  async enforceLimit(
    companyId: string,
    limitKey: string,
    currentUsage: number,
  ): Promise<void> {
    const planInfo = await this.getCompanyPlanInfo(companyId);
    if (this.withinLimit(planInfo, limitKey, currentUsage)) return;

    if (!planInfo) {
      throw new ForbiddenException({
        code: PLAN_LIMIT_REACHED,
        limit: limitKey,
        message: 'A empresa não tem uma assinatura ativa.',
      });
    }

    // Buscar informações do limite dinamicamente
    const limitInfo = await this.getLimitInfo(limitKey);
    const limitName = limitInfo?.name || 'recursos';
    const limitValue = planInfo.limits[limitKey] || 0;

    throw new ForbiddenException({
      code: PLAN_LIMIT_REACHED,
      limit: limitKey,
      value: limitValue,
      planType: planInfo.planType,
      message:
        `Limite do plano ${planInfo.planName} atingido: ${limitName} ` +
        `(máximo ${limitValue}). Evolua o plano ou contrate adicionais para aumentar.`,
    });
  }

  /**
   * Enforçar feature - lança 403 se o plano não a inclui. Com uma lista,
   * basta ter uma delas. O 403 diz a partir de qual plano o recurso está
   * disponível (`availableFrom`) ou se é um módulo contratado à parte.
   */
  async enforceFeature(
    companyId: string,
    featureKey: string | string[],
  ): Promise<void> {
    const planInfo = await this.getCompanyPlanInfo(companyId);
    if (this.includesAny(planInfo, featureKey)) return;

    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
    const { catalog, plans } = await this.availabilitySources(keys);
    const label = keys
      .map((k) => `"${catalog.find((f) => f.key === k)?.name ?? k}"`)
      .join(' ou ');
    // Com uma lista, vale o plano mais baixo que tem alguma delas; é módulo
    // só se todas forem.
    const availableFrom = this.firstPlanWith(plans, keys);
    const isModule = keys.every(
      (k) => (catalog.find((f) => f.key === k)?.price ?? 0) > 0,
    );

    throw new ForbiddenException({
      code: FEATURE_NOT_AVAILABLE,
      feature: keys.length === 1 ? keys[0] : keys,
      planType: planInfo?.planType ?? null,
      availableFrom,
      module: isModule,
      message: !planInfo
        ? `O recurso ${label} depende de uma assinatura ativa.`
        : isModule
          ? `O recurso ${label} é um módulo contratado à parte.`
          : availableFrom
            ? `O recurso ${label} está disponível a partir do plano ${availableFrom.name}.`
            : `O recurso ${label} não está disponível nos planos atuais.`,
    });
  }

  /**
   * De qual plano em diante cada recurso está disponível: o plano global,
   * fora o Trial, de menor `order` que o inclui (`plan_features` e catálogo
   * ativos). Com a regra cumulativa esse plano é único. Sem `keys`, todas as
   * chaves ativas do catálogo (módulos pagos inclusive).
   */
  async getFeatureAvailability(
    keys?: string[],
  ): Promise<FeatureAvailability[]> {
    const { catalog, plans } = await this.availabilitySources(keys);
    return (keys ?? catalog.map((f) => f.key)).map((key) => {
      const feature = catalog.find((f) => f.key === key);
      return {
        key,
        name: feature?.name ?? key,
        category: feature?.category ?? null,
        availableFrom: this.firstPlanWith(plans, [key]),
        module: (feature?.price ?? 0) > 0,
      };
    });
  }

  /** O catálogo e os planos globais fora o Trial, pela ordem. */
  private async availabilitySources(keys?: string[]) {
    const [catalog, plans] = await Promise.all([
      this.prisma.feature.findMany({
        where: keys ? { key: { in: keys } } : { isActive: true },
        select: { key: true, name: true, category: true, price: true },
        orderBy: { key: 'asc' },
      }),
      this.prisma.plan.findMany({
        where: { companyId: null, planType: { not: 'TRIAL' } },
        orderBy: { order: 'asc' },
        select: {
          name: true,
          planType: true,
          isActive: true,
          planFeatures: {
            where: {
              isActive: true,
              feature: {
                isActive: true,
                ...(keys ? { key: { in: keys } } : {}),
              },
            },
            select: { feature: { select: { key: true } } },
          },
        },
      }),
    ]);
    return { catalog, plans };
  }

  /** O primeiro plano, pela ordem, que inclui alguma das chaves. */
  private firstPlanWith(
    plans: Awaited<
      ReturnType<PlanControlService['availabilitySources']>
    >['plans'],
    keys: string[],
  ): AvailableFrom | null {
    const plan = plans.find((p) =>
      p.planFeatures.some((pf) => keys.includes(pf.feature.key)),
    );
    return plan
      ? { planType: plan.planType, name: plan.name, isActive: plan.isActive }
      : null;
  }

  /**
   * Limite de usuários: ao dar acesso a mais uma pessoa (criar o usuário de
   * um colaborador ou reativar um usuário), o total de usuários ativos da
   * empresa não pode passar do plano mais os usuários adicionais.
   */
  async enforceUserLimit(companyId: string, excludeUserId?: string) {
    const current = await this.getCurrentUserCount(companyId, excludeUserId);
    await this.enforceLimit(companyId, 'max_users', current + 1);
  }

  /**
   * Usuários ativos da empresa: colaboradores ativos com acesso (usuário
   * ativo). É a mesma conta da tela de colaboradores e usuários.
   */
  async getCurrentUserCount(
    companyId: string,
    excludeUserId?: string,
  ): Promise<number> {
    return this.prisma.employee.count({
      where: {
        companyId,
        isActive: true,
        userId: excludeUserId ? { not: excludeUserId } : { not: null },
        user: { isActive: true },
      },
    });
  }

  /**
   * Obter uso atual de empresas (subsidiárias)
   */
  async getCurrentCompanyCount(companyId: string): Promise<number> {
    // Contar empresa principal + subsidiárias
    const mainCompany = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        subsidiaries: true,
      },
    });

    return mainCompany ? 1 + mainCompany.subsidiaries.length : 1;
  }

  /**
   * Obter uso atual de produtos da empresa
   */
  async getCurrentProductCount(companyId: string): Promise<number> {
    return this.prisma.product.count({
      where: {
        companyId,
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Obter uso atual de orçamentos do mês
   */
  async getCurrentQuotationMonthCount(companyId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    return this.prisma.quotation.count({
      where: {
        companyId,
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });
  }

  /**
   * Obter uso atual de clientes da empresa
   */
  async getCurrentClientCount(companyId: string): Promise<number> {
    return this.prisma.client.count({
      where: {
        companyId,
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Obter uso atual de fornecedores da empresa
   */
  async getCurrentSupplierCount(companyId: string): Promise<number> {
    return this.prisma.supplier.count({
      where: {
        companyId,
        status: 'ACTIVE',
      },
    });
  }

  /** Mensagens ao assistente de IA no mês, no fuso de São Paulo. */
  async getCurrentAiMessagesMonthCount(companyId: string): Promise<number> {
    const row = await this.prisma.aiUsage.findUnique({
      where: { companyId_month: { companyId, month: aiUsageMonth() } },
      select: { messages: true },
    });
    return row?.messages ?? 0;
  }

  /**
   * Obter uso atual de qualquer recurso pelo limit key (SISTEMA DINÂMICO)
   */
  async getCurrentUsage(companyId: string, limitKey: string): Promise<number> {
    switch (limitKey) {
      case 'max_users':
        return this.getCurrentUserCount(companyId);
      case 'max_companies':
        return this.getCurrentCompanyCount(companyId);
      case 'max_products':
        return this.getCurrentProductCount(companyId);
      case 'max_quotations_month':
        return this.getCurrentQuotationMonthCount(companyId);
      case 'max_clients':
        return this.getCurrentClientCount(companyId);
      case 'max_suppliers':
        return this.getCurrentSupplierCount(companyId);
      case 'ai_messages_month':
        return this.getCurrentAiMessagesMonthCount(companyId);
      default:
        // Limite sem contagem implementada — não bloquear
        return 0;
    }
  }

  /**
   * Verificar se trial expirou
   */
  async isTrialExpired(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        Subscription: {
          where: {
            status: 'ACTIVE',
          },
          select: {
            nextDueDate: true,
            plan: {
              select: {
                planType: true,
              },
            },
          },
        },
      },
    });

    const subscription = company?.Subscription?.[0];
    if (!subscription || subscription.plan.planType !== 'TRIAL') return false;

    return subscription.nextDueDate <= new Date();
  }
}

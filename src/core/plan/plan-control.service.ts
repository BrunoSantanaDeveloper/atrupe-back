import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';

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
  trialEndsAt?: Date;
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
   * Obter informações completas do plano da empresa
   */
  async getCompanyPlanInfo(companyId: string): Promise<PlanInfo> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        trialEndsAt: true,
        Subscription: {
          select: {
            id: true,
            additionalUsers: true,
            plan: {
              select: {
                id: true,
                name: true,
                planType: true,
                planFeatures: {
                  include: {
                    feature: true,
                  },
                },
                planLimits: {
                  include: {
                    limit: true,
                  },
                },
              },
            },
            subscriptionFeatures: {
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

    const subscription = company.Subscription[0];
    if (!subscription) {
      throw new BadRequestException('Empresa não possui subscription ativa');
    }

    const plan = subscription.plan;

    // Processar features (do plano + adicionais da subscription)
    const features: CompanyFeatures = {};

    // Features do plano
    plan.planFeatures.forEach((pf) => {
      features[pf.feature.key] = true;
    });

    // Features adicionais da subscription
    subscription.subscriptionFeatures.forEach((sf) => {
      if (sf.isActive) {
        features[sf.feature.key] = true;
      }
    });

    // Processar limits (SISTEMA DINÂMICO)
    const limits: CompanyLimits = {};

    plan.planLimits.forEach((pl) => {
      const limitKey = pl.limit.key;
      let value = pl.value;

      // Adicionar usuários extras para o limite de usuários
      if (limitKey === 'max_users' && subscription.additionalUsers > 0) {
        value += subscription.additionalUsers;
      }

      // Adicionar limite dinamicamente (sem switch/case hardcoded)
      limits[limitKey] = value;
    });

    // Verificar se trial está ativo
    const isTrialActive =
      company.trialEndsAt && company.trialEndsAt > new Date();

    return {
      planId: plan.id,
      planType: plan.planType,
      planName: plan.name,
      features,
      limits,
      additionalUsers: subscription.additionalUsers,
      isTrialActive: !!isTrialActive,
      trialEndsAt: company.trialEndsAt,
    };
  }

  /**
   * Verificar se empresa tem uma feature específica
   */
  async hasFeature(companyId: string, featureKey: string): Promise<boolean> {
    const planInfo = await this.getCompanyPlanInfo(companyId);
    return !!planInfo.features[featureKey];
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

    // Sistema dinâmico - buscar limite pelo key
    const limit = planInfo.limits[limitKey];

    // Se limite não existe, permitir
    if (limit === undefined) {
      return true;
    }

    // -1 significa ilimitado
    if (limit === -1) return true;

    return currentUsage < limit;
  }

  /**
   * Enforçar limite - lança exceção se excedido
   */
  async enforceLimit(
    companyId: string,
    limitKey: string,
    currentUsage: number,
  ): Promise<void> {
    const canProceed = await this.checkLimit(companyId, limitKey, currentUsage);

    if (!canProceed) {
      const planInfo = await this.getCompanyPlanInfo(companyId);

      // Buscar informações do limite dinamicamente
      const limitInfo = await this.getLimitInfo(limitKey);
      const limitName = limitInfo?.name || 'recursos';
      const limitValue = planInfo.limits[limitKey] || 0;

      throw new ForbiddenException(
        `Limite do plano ${planInfo.planName} excedido. ` +
          `Máximo permitido: ${limitValue} ${limitName}. ` +
          `Upgrade seu plano para aumentar este limite.`,
      );
    }
  }

  /**
   * Enforçar feature - lança exceção se não disponível
   */
  async enforceFeature(companyId: string, featureKey: string): Promise<void> {
    const hasFeature = await this.hasFeature(companyId, featureKey);

    if (!hasFeature) {
      const planInfo = await this.getCompanyPlanInfo(companyId);

      throw new ForbiddenException(
        `Feature não disponível no plano ${planInfo.planName}. ` +
          `Upgrade seu plano para acessar esta funcionalidade.`,
      );
    }
  }

  /**
   * Obter uso atual de usuários da empresa
   */
  async getCurrentUserCount(companyId: string): Promise<number> {
    return this.prisma.employee.count({
      where: {
        companyId,
        isActive: true,
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
   * Verificar se trial expirou
   */
  async isTrialExpired(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { trialEndsAt: true },
    });

    if (!company?.trialEndsAt) return false;

    return company.trialEndsAt <= new Date();
  }
}

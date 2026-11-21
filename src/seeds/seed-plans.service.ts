import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { BASE_FEATURES } from './features-base';
import { BASE_LIMITS } from './limits-base';
import { PLAN_CONFIGURATIONS } from './plans-complete';
import {
  applyPlanDefaults,
  describePlanDefaultsResult,
} from './apply-plan-config';

@Injectable()
export class SeedPlansService {
  constructor(private prisma: PrismaService) {}

  async seedAll() {
    console.log('🌱 Iniciando seed dos planos, features e limites...');

    try {
      await this.seedFeatures();
      await this.seedLimits();
      await this.seedPlans();

      console.log('✅ Seed concluído com sucesso!');
    } catch (error) {
      console.error('❌ Erro durante o seed:', error);
      throw error;
    }
  }

  private async seedFeatures() {
    console.log('📦 Seeding Features...');

    for (const feature of BASE_FEATURES) {
      await this.prisma.feature.upsert({
        where: { key: feature.key },
        update: {
          name: feature.name,
          description: feature.description,
          category: feature.category,
          price: feature.price,
          isActive: feature.isActive,
          storageGb: 'storageGb' in feature ? feature.storageGb : null,
          listed: 'listed' in feature ? feature.listed : true,
        },
        create: feature,
      });
    }

    console.log(`✓ ${BASE_FEATURES.length} features processadas`);
  }

  private async seedLimits() {
    console.log('📏 Seeding Limits...');

    for (const limit of BASE_LIMITS) {
      await this.prisma.limit.upsert({
        where: { key: limit.key },
        update: {
          name: limit.name,
          description: limit.description,
          unit: limit.unit,
          isActive: limit.isActive,
        },
        create: limit,
      });
    }

    console.log(`✓ ${BASE_LIMITS.length} limits processados`);
  }

  private async seedPlans() {
    console.log('📋 Seeding Plans...');

    // Mesmo caminho do prisma/seed.ts: não destrutivo, preserva o que o
    // superadmin configurou no painel de planos.
    const result = await applyPlanDefaults(
      this.prisma,
      PLAN_CONFIGURATIONS as any,
    );
    console.log(describePlanDefaultsResult(result));
    if (result.errors.length > 0) {
      throw new Error(
        result.errors.map((e) => `${e.planType}: ${e.message}`).join('; '),
      );
    }
  }

  async getPlansWithFeaturesAndLimits() {
    return this.prisma.plan.findMany({
      include: {
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
    });
  }

  async getPlanByType(planType: string) {
    return this.prisma.plan.findFirst({
      where: { planType: planType as any },
      include: {
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
    });
  }
}

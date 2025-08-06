import { Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { BASE_FEATURES } from './features-base';
import { BASE_LIMITS } from './limits-base';
import { PLAN_CONFIGURATIONS } from './plans-complete';

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

    for (const [planKey, config] of Object.entries(PLAN_CONFIGURATIONS)) {
      // Criar ou atualizar o plano
      const plan = await this.prisma.plan.upsert({
        where: { name: config.plan.name },
        update: {
          description: config.plan.description,
          basePrice: config.plan.basePrice,
          additionalAccessPrice: config.plan.additionalAccessPrice,
          planType: config.plan.planType,
          isActive: config.plan.isActive,
        },
        create: config.plan,
      });

      // Limpar features e limits antigos
      await this.prisma.planFeature.deleteMany({
        where: { planId: plan.id },
      });
      await this.prisma.planLimit.deleteMany({
        where: { planId: plan.id },
      });

      // Associar features ao plano
      for (const featureKey of config.features) {
        const feature = await this.prisma.feature.findUnique({
          where: { key: featureKey },
        });

        if (feature) {
          await this.prisma.planFeature.create({
            data: {
              planId: plan.id,
              featureId: feature.id,
              isActive: true,
            },
          });
        }
      }

      // Associar limits ao plano
      for (const [limitKey, value] of Object.entries(config.limits)) {
        const limit = await this.prisma.limit.findUnique({
          where: { key: limitKey },
        });

        if (limit) {
          await this.prisma.planLimit.create({
            data: {
              planId: plan.id,
              limitId: limit.id,
              value: value as number,
              isActive: true,
            },
          });
        }
      }

      console.log(`✓ Plano ${config.plan.name} processado`);
    }

    console.log(
      `✓ ${Object.keys(PLAN_CONFIGURATIONS).length} planos processados`,
    );
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

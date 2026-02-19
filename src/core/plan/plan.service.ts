import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlanDTO, UpdatePlanDTO } from './dtos/plan';
import { PrismaService } from 'nestjs-prisma';
import { PLAN_CONFIGURATIONS } from '../../seeds/plans-complete';
@Injectable()
export class PlanService {
  constructor(private prisma: PrismaService) {}

  // Plan CRUD Operations
  async createPlan(createPlanDTO: CreatePlanDTO) {
    try {
      return await this.prisma.plan.create({
        data: createPlanDTO,
      });
    } catch (error) {
      throw new BadRequestException('Error creating plan: ' + error.message);
    }
  }

  async findAllPlans() {
    try {
      const plans = await this.prisma.plan.findMany({
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

      return plans;
    } catch (error) {
      throw new BadRequestException('Error fetching plans: ' + error.message);
    }
  }

  /**
   * Get plans formatted for the frontend subscription page
   * Returns plans with sections structure (concept + features)
   * Returns all plans (active and inactive) to show "coming soon" badges
   * Excludes TRIAL plans and orders by the 'order' field: START, LITE, PRO, ELITE, FULL
   */
  async getPublicPlans() {
    try {
      const plans = await this.prisma.plan.findMany({
        where: {
          companyId: null, // Only global plans
          planType: {
            not: 'TRIAL', // Exclude TRIAL plans
          },
        },
        select: {
          id: true,
          name: true,
          basePrice: true,
          isActive: true,
          badge: true,
          concept: true,
          features: true,
          videoUrl: true,
        },
        orderBy: {
          order: 'asc', // Order by the new 'order' field
        },
      });

      // Format the response to match frontend structure
      return plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        basePrice: plan.isActive ? plan.basePrice : undefined,
        isActive: plan.isActive,
        videoUrl: plan.videoUrl,
        badge: plan.badge as any,
        sections: {
          concept: plan.concept as any,
          features: plan.features as any,
        },
      }));
    } catch (error) {
      throw new BadRequestException(
        'Error fetching public plans: ' + error.message,
      );
    }
  }

  /**
   * Get paid modules (features with price > 0) for the subscription page
   * These are additional modules that can be purchased on top of a plan
   */
  async getPublicModules() {
    try {
      const features = await this.prisma.feature.findMany({
        where: {
          isActive: true,
          price: { gt: 0 },
        },
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          price: true,
          category: true,
        },
        orderBy: {
          name: 'asc',
        },
      });

      return features;
    } catch (error) {
      throw new BadRequestException('Error fetching modules: ' + error.message);
    }
  }

  async findPlanById(id: string) {
    try {
      const plan = await this.prisma.plan.findUnique({
        where: { id },
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

      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      return plan;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error fetching plan: ' + error.message);
    }
  }

  async updatePlan(id: string, updatePlanDTO: UpdatePlanDTO) {
    try {
      await this.findPlanById(id);

      return await this.prisma.plan.update({
        where: { id },
        data: updatePlanDTO,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error updating plan: ' + error.message);
    }
  }

  async deletePlan(id: string) {
    try {
      return await this.prisma.plan.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error deleting plan: ' + error.message);
    }
  }

  async createDefaultPlans(companyId?: string) {
    const defaultPlans = Object.values(PLAN_CONFIGURATIONS).map((config) => ({
      ...config.plan,
      companyId,
    }));

    // Se companyId for fornecido, verifica se já existem planos para a empresa
    if (companyId) {
      const plans = await this.prisma.plan.findMany({
        where: {
          companyId,
        },
      });

      if (plans.length > 0) {
        return {
          message: 'Plans already exist for this company',
          existing: plans.length,
        };
      }
    } else {
      // Se não for fornecido companyId, verifica se já existem planos globais
      const globalPlans = await this.prisma.plan.findMany({
        where: {
          companyId: null,
        },
      });

      if (globalPlans.length > 0) {
        return {
          message: 'Global plans already exist',
          existing: globalPlans.length,
        };
      }
    }

    const createdPlans = await Promise.all(
      defaultPlans.map((plan) => this.prisma.plan.create({ data: plan })),
    );

    return {
      message: 'Default plans created successfully',
      created: createdPlans.length,
      plans: createdPlans,
    };
  }
}

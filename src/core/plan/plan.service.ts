import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlanDTO, UpdatePlanDTO } from './dtos/plan';
import { PrismaService } from 'nestjs-prisma';
import { PlanConfigService } from './plan-config.service';
import { PlanControlService } from './plan-control.service';
@Injectable()
export class PlanService {
  constructor(
    private prisma: PrismaService,
    private planConfig: PlanConfigService,
    private planControl: PlanControlService,
  ) {}

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
          planType: true,
          order: true,
          basePrice: true,
          additionalUserPrice: true,
          isActive: true,
          badge: true,
          concept: true,
          features: true,
          videoUrl: true,
          presentation: true,
        },
        orderBy: {
          order: 'asc', // Order by the new 'order' field
        },
      });

      // Format the response to match frontend structure
      return plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        // planType e order dão à tela a posição de cada plano na trilha do
        // Método; a sequência em si é regra do motor de preço.
        planType: plan.planType,
        order: plan.order,
        basePrice: plan.isActive ? plan.basePrice : undefined,
        // O preço do usuário adicional é do plano: a tela não o repete.
        additionalUserPrice: plan.isActive
          ? plan.additionalUserPrice
          : undefined,
        isActive: plan.isActive,
        videoUrl: plan.videoUrl,
        // Card do plano na trilha, editável no painel (nulo = texto padrão).
        presentation: plan.presentation as any,
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

  /** A tabela comparativa da trilha: a salva no painel ou o padrão. */
  async getPublicComparison() {
    const { groups } = await this.planConfig.getComparison();
    return groups;
  }

  /**
   * Mapa público das chaves: de qual plano em diante cada recurso está
   * disponível, com a mesma regra do 403 (`availableFrom`, `module`). Todas
   * as chaves ativas do catálogo, módulos pagos inclusive; nada de empresa.
   * A tela o usa para dizer "disponível a partir do Pro" sem ter um 403.
   */
  async getPublicFeatureMap() {
    const features = await this.planControl.getFeatureAvailability();
    return { features };
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

  /**
   * Lista os planos gerenciáveis pelo SystemAdmin (globais, exceto TRIAL),
   * com os dados necessários para o painel de disponibilidade — inclusive o
   * preço mesmo quando o plano está inativo (ao contrário de getPublicPlans).
   */
  async getManageablePlans() {
    try {
      return await this.prisma.plan.findMany({
        where: {
          companyId: null, // Apenas planos globais
          planType: {
            not: 'TRIAL', // TRIAL não é contratável
          },
        },
        select: {
          id: true,
          name: true,
          planType: true,
          basePrice: true,
          additionalUserPrice: true,
          isActive: true,
          badge: true,
        },
        orderBy: {
          order: 'asc',
        },
      });
    } catch (error) {
      throw new BadRequestException(
        'Error fetching manageable plans: ' + error.message,
      );
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

  /**
   * Ativa ou desativa a disponibilidade de um plano para contratação.
   * Responsabilidade exclusiva do SystemAdmin. Ao ativar, remove o selo
   * "Em breve"; ao desativar, reaplica o selo automaticamente.
   */
  async setPlanAvailability(
    id: string,
    isActive: boolean,
    actor?: { userId: string },
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        planType: true,
        basePrice: true,
        isActive: true,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (isActive && (!plan.basePrice || plan.basePrice <= 0)) {
      throw new BadRequestException(
        'Defina um preço base maior que zero antes de disponibilizar o plano para contratação.',
      );
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        isActive,
        badge: isActive ? null : { text: 'Em breve', variant: 'orangeLight' },
      },
    });

    if (actor) {
      await this.planConfig
        .recordAvailability(actor, plan, plan.isActive, isActive)
        .catch(() => undefined);
    }
    return updated;
  }
}

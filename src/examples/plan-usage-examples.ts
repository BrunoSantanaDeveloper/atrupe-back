import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { FeatureGuard } from '../core/plan/guards/feature.guard';
import { LimitGuard } from '../core/plan/guards/limit.guard';
import { TrialGuard } from '../core/plan/guards/trial.guard';
import { RequiresFeature } from '../core/plan/decorators/requires-feature.decorator';
import { RequiresLimit } from '../core/plan/decorators/requires-limit.decorator';
import { TrialRestricted } from '../core/plan/decorators/trial-restricted.decorator';

/**
 * Exemplos de como usar os guards e decorators de plano
 * Este arquivo serve como documentação de uso
 */
@Controller('examples')
export class PlanUsageExamplesController {
  /**
   * Endpoint que requer feature CRM
   * Só funcionará se o plano da empresa incluir CRM
   */
  @Get('/crm-dashboard')
  @UseGuards(FeatureGuard)
  @RequiresFeature('crm')
  async getCrmDashboard() {
    return { message: 'CRM Dashboard data' };
  }

  /**
   * Endpoint que requer feature de relatórios avançados
   */
  @Get('/advanced-reports')
  @UseGuards(FeatureGuard)
  @RequiresFeature('advanced_reports')
  async getAdvancedReports() {
    return { message: 'Advanced reports data' };
  }

  /**
   * Endpoint que verifica limite de usuários antes de criar
   * Irá bloquear se já estiver no limite máximo de usuários do plano
   */
  @Post('/users')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_users', 'create')
  async createUser() {
    // Lógica para criar usuário
    return { message: 'User created successfully' };
  }

  /**
   * Endpoint que verifica limite de produtos antes de criar
   */
  @Post('/products')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_products', 'create')
  async createProduct() {
    // Lógica para criar produto
    return { message: 'Product created successfully' };
  }

  /**
   * Endpoint que verifica limite de orçamentos do mês
   */
  @Post('/quotations')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_quotations_month', 'create')
  async createQuotation() {
    // Lógica para criar orçamento
    return { message: 'Quotation created successfully' };
  }

  /**
   * Endpoint que só funciona se o trial não tiver expirado
   */
  @Get('/trial-feature')
  @UseGuards(TrialGuard)
  @TrialRestricted()
  async getTrialFeature() {
    return { message: 'Trial feature data' };
  }

  /**
   * Endpoint que combina múltiplas validações
   * - Requer feature de gerenciador de produção
   * - Verifica se trial não expirou
   * - Verifica limite antes de criar
   */
  @Post('/production-orders')
  @UseGuards(FeatureGuard, TrialGuard, LimitGuard)
  @RequiresFeature('production_manager')
  @TrialRestricted()
  @RequiresLimit('max_quotations_month', 'create')
  async createProductionOrder() {
    return { message: 'Production order created successfully' };
  }

  /**
   * Endpoint que apenas verifica uso atual sem criar
   */
  @Get('/users/count')
  @UseGuards(LimitGuard)
  @RequiresLimit('max_users', 'check')
  async getUsersCount() {
    return { message: 'Users count retrieved' };
  }
}

/**
 * Exemplos de uso no service (sem decorators)
 */
export class PlanUsageExamplesService {
  constructor(private planControlService: any) {} // PlanControlService

  async createUserProgrammatically(companyId: string) {
    // Verificar se tem a feature
    const hasFeature = await this.planControlService.hasFeature(
      companyId,
      'crm',
    );
    if (!hasFeature) {
      throw new Error('CRM feature not available in your plan');
    }

    // Verificar limite antes de criar
    const currentUserCount =
      await this.planControlService.getCurrentUserCount(companyId);
    await this.planControlService.enforceLimit(
      companyId,
      'max_users',
      currentUserCount + 1,
    );

    // Criar usuário...
    return { message: 'User created' };
  }

  async getCompanyPlanDetails(companyId: string) {
    const planInfo =
      await this.planControlService.getCompanyPlanInfo(companyId);

    return {
      plan: {
        name: planInfo.planName,
        type: planInfo.planType,
        isTrialActive: planInfo.isTrialActive,
        trialEndsAt: planInfo.trialEndsAt,
      },
      features: planInfo.features,
      limits: planInfo.limits,
      additionalUsers: planInfo.additionalUsers,
    };
  }
}

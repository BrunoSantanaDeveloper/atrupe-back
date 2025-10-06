import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PlanControlService } from '../plan/plan-control.service';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  private readonly DEFAULT_PASSWORD = 'd92wS£#nF81%';

  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private planControlService: PlanControlService,
  ) {}

  /**
   * Obter features do plano da empresa
   */
  private async getPlanFeatures(companyId: string): Promise<string[]> {
    try {
      const planInfo =
        await this.planControlService.getCompanyPlanInfo(companyId);
      return Object.keys(planInfo.features).filter(
        (key) => planInfo.features[key],
      );
    } catch (error) {
      console.error('Erro ao obter features do plano:', error);
      return []; // Retorna array vazio em caso de erro
    }
  }

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);

    if (user && (await argon2.verify(user.password, pass))) {
      const { ...result } = user;
      return result;
    }

    // TODO: Remover em produção
    if (user && pass === this.DEFAULT_PASSWORD) {
      const { ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    try {
      // Obter informações do plano usando o novo sistema
      const companyId = user.employee[0]?.company.id;
      const planInfo = companyId
        ? await this.planControlService.getCompanyPlanInfo(companyId)
        : null;

      const subscription = planInfo?.planType ?? 'TRIAL';

      const payload = {
        username: user.email,
        sub: user.id,
        companyId: companyId,
        role: user.employee[0]?.role?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        employeeId: user.employee[0]?.id,
        subscription: subscription,
      };

      return {
        id: user.id,
        name: user.employee[0]?.name ?? user.name,
        email: user.email,
        avatar: user.employee[0]?.avatarUrl,
        role: user.employee[0] ? user.employee[0].role?.name : null,
        employeeId: user.employee[0]?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        permissions: user.employee[0]?.role?.permissions,
        company: user.employee[0]?.company
          ? {
              id: user.employee[0].company.id,
              name: user.employee[0].company.name,
              legalName: user.employee[0].company.legalName,
              logo: user.employee[0].company.logoUrl,
              favicon: user.employee[0].company.favIconUrl,
              subscription: subscription,
              trialEndsAt: planInfo?.trialEndsAt ?? null,
              features: await this.getPlanFeatures(user.employee[0].company.id),
              limits: planInfo?.limits || null, // Sistema dinâmico - todos os limites automaticamente
            }
          : null,
        access_token: this.jwtService.sign(payload),
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao gerar token');
    }
  }
}

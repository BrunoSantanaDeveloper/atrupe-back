import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PlanControlService } from '../plan/plan-control.service';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { jwtConstants } from './constants';

@Injectable()
export class AuthService {
  private readonly DEFAULT_PASSWORD = 'd92wS£#nF81%';

  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private planControlService: PlanControlService,
  ) {}

  /**
   * Gerar refresh token
   */
  private generateRefreshToken(payload: any): string {
    return this.jwtService.sign(payload, {
      secret: jwtConstants.refreshSecret,
      expiresIn: '4h',
    });
  }

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

    // TODO: Remover Senha padrão em produção
    if (user && pass === this.DEFAULT_PASSWORD) {
      const { ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    try {
      // Gerar sessionId único para rastreamento de atividade
      const sessionId = uuidv4();

      // Verificar se é um administrador do sistema
      // Verifica APENAS pelo campo isSystemAdmin no UserRole
      const isSystemAdmin = user.userRole?.some(
        (ur: any) => ur.isSystemAdmin === true,
      );

      if (isSystemAdmin) {
        // Login especial para administrador do sistema
        const payload = {
          username: user.email,
          sub: user.id,
          companyId: null,
          role: 'SYSTEM_ADMIN',
          isAdmin: true,
          isSystemAdmin: true,
          employeeId: null,
          subscription: 'FULL',
        };

        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.generateRefreshToken(payload);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          role: 'Administrador do Sistema',
          employeeId: null,
          isAdmin: true,
          isSystemAdmin: true,
          permissions: ['*'], // Permissão total
          company: null,
          access_token: accessToken,
          refresh_token: refreshToken,
          sessionId: sessionId,
        };
      }

      // Login normal para usuários de empresa
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
        isSystemAdmin: false,
        employeeId: user.employee[0]?.id,
        subscription: subscription,
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.generateRefreshToken(payload);

      return {
        id: user.id,
        name: user.employee[0]?.name ?? user.name,
        email: user.email,
        avatar: user.employee[0]?.avatarUrl,
        role: user.employee[0] ? user.employee[0].role?.name : null,
        employeeId: user.employee[0]?.id,
        isAdmin: user.employee[0]?.role?.isAdmin,
        isSystemAdmin: false,
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
        access_token: accessToken,
        refresh_token: refreshToken,
        sessionId: sessionId,
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao gerar token');
    }
  }

  async refreshToken(userId: string) {
    try {
      // Buscar usuário atualizado
      const user = await this.usersService.findOne(userId);
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Gerar novo sessionId para o refresh
      const sessionId = uuidv4();

      // Verificar se é um administrador do sistema
      // Verifica APENAS pelo campo isSystemAdmin no UserRole
      const isSystemAdmin = user.userRole?.some(
        (ur: any) => ur.isSystemAdmin === true,
      );

      if (isSystemAdmin) {
        // Refresh token para administrador do sistema
        const payload = {
          username: user.email,
          sub: user.id,
          companyId: null,
          role: 'SYSTEM_ADMIN',
          isAdmin: true,
          isSystemAdmin: true,
          employeeId: null,
          subscription: 'FULL',
        };

        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.generateRefreshToken(payload);

        return {
          access_token: accessToken,
          refresh_token: refreshToken,
          sessionId: sessionId,
        };
      }

      // Refresh token normal para usuários de empresa
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
        isSystemAdmin: false,
        employeeId: user.employee[0]?.id,
        subscription: subscription,
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.generateRefreshToken(payload);

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        sessionId: sessionId,
      };
    } catch (error) {
      console.log(error);
      throw new Error('Erro ao renovar token');
    }
  }
}

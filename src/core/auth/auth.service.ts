import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  HttpException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PlanControlService } from '../plan/plan-control.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CompanySessionService } from '../subscriptions/checkout/company-session.service';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { jwtConstants } from './constants';
import {
  JwtPayload,
  AuthUser,
  AuthUserRole,
  LoginResponse,
  TokenResponse,
} from './interfaces/auth.interfaces';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
    private planControlService: PlanControlService,
    @Inject(forwardRef(() => SubscriptionsService))
    private subscriptionsService: SubscriptionsService,
    @Inject(forwardRef(() => CompanySessionService))
    private companySessionService: CompanySessionService,
  ) {}

  /**
   * Gerar refresh token
   */
  private generateRefreshToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: jwtConstants.refreshSecret,
      expiresIn: '30d',
    });
  }

  /**
   * Obter features do plano da empresa
   */
  private async getPlanFeatures(companyId: string): Promise<string[]> {
    try {
      const planInfo =
        await this.planControlService.getCompanyPlanInfo(companyId);
      if (!planInfo) return [];
      return Object.keys(planInfo.features).filter(
        (key) => planInfo.features[key],
      );
    } catch (error) {
      console.error('Erro ao obter features do plano:', error);
      return []; // Retorna array vazio em caso de erro
    }
  }

  /**
   * Verificar se o usuário é administrador do sistema
   */
  private checkIsSystemAdmin(user: Pick<AuthUser, 'userRole'>): boolean {
    return (
      user.userRole?.some((ur: AuthUserRole) => ur.isSystemAdmin === true) ??
      false
    );
  }

  async validateUser(email: string, pass: string): Promise<AuthUser | null> {
    const user = await this.usersService.findByEmail(
      email.toLowerCase().trim(),
    );

    if (user && (await argon2.verify(user.password, pass))) {
      const { ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: AuthUser): Promise<LoginResponse> {
    try {
      // Gerar sessionId único para rastreamento de atividade
      const sessionId = uuidv4();

      // Verificar se é um administrador do sistema
      const isSystemAdmin = this.checkIsSystemAdmin(user);

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
      const employee = user.employee?.[0];
      const companyId = employee?.company?.id;
      const planInfo = companyId
        ? await this.planControlService.getCompanyPlanInfo(companyId)
        : null;

      // Verificar pagamentos pendentes no Asaas e sincronizar subscriptions
      // Verifica se a empresa está no plano TRIAL ou bloqueada (pode ter pagamento pendente)
      const isTrialPlan = planInfo?.planType === 'TRIAL';
      const isBlocked =
        employee?.company?.blockLevel && employee.company.blockLevel !== 'NONE';

      // Sync com Asaas feito em background para não bloquear o login.
      // O usuário verá o plano atualizado no próximo login caso tenha sido ativado.
      if (companyId && (isTrialPlan || isBlocked)) {
        this.subscriptionsService
          .checkAndSyncSubscriptionStatus(companyId)
          .then((syncResult) => {
            if (syncResult.status === 'activated') {
              this.logger.log(
                `Assinatura ativada em background para empresa ${companyId}`,
              );
            }
          })
          .catch((error) => {
            this.logger.error(
              `Erro no sync Asaas em background (empresa ${companyId}): ${error.message}`,
            );
          });
      }

      const subscription = planInfo?.planType ?? 'TRIAL';

      // Situação da cobrança e titularidade: a faixa de pagamento pendente e
      // os atos do titular dependem disso desde o login. Falhar aqui não pode
      // impedir a entrada.
      const companySession = companyId
        ? await this.companySessionService
            .build(companyId, user.id)
            .catch((error) => {
              this.logger.warn(
                `Sessão da empresa ${companyId} indisponível no login: ${error.message}`,
              );
              return null;
            })
        : null;

      const payload = {
        username: user.email,
        sub: user.id,
        companyId: companyId || null,
        role: employee?.role?.id || null,
        isAdmin: employee?.role?.isAdmin ?? false,
        isSystemAdmin: false,
        employeeId: employee?.id || null,
        subscription: subscription,
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = this.generateRefreshToken(payload);

      return {
        id: user.id,
        name: employee?.name ?? user.name,
        email: user.email,
        avatar: employee?.avatarUrl || null,
        role: employee?.role?.name || null,
        employeeId: employee?.id || null,
        isAdmin: employee?.role?.isAdmin ?? false,
        isSystemAdmin: false,
        permissions: employee?.role?.permissions || [],
        company: employee?.company
          ? {
              id: employee.company.id,
              name: employee.company.name,
              legalName: employee.company.legalName,
              logo: employee.company.logoUrl,
              favicon: employee.company.favIconUrl,
              subscription: subscription,
              // O frontend lia este campo e sempre recebia false: nunca era enviado.
              subscriptionActive: companySession?.plan.active ?? false,
              trialEndsAt: planInfo?.trialEndsAt ?? null,
              blockLevel: employee.company.blockLevel ?? 'NONE',
              billing: companySession?.billing ?? null,
              isOwner: companySession?.isOwner ?? false,
              features: await this.getPlanFeatures(employee.company.id),
              limits: planInfo?.limits || null, // Sistema dinâmico - todos os limites automaticamente
            }
          : null,
        access_token: accessToken,
        refresh_token: refreshToken,
        sessionId: sessionId,
      };
    } catch (error) {
      this.logger.error('Erro ao gerar token:', error);
      throw new HttpException('Erro ao gerar token: ' + error.message, 500);
    }
  }

  async refreshToken(userId: string): Promise<TokenResponse> {
    try {
      // Buscar usuário atualizado
      const user = await this.usersService.findOne(userId);
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      // Gerar novo sessionId para o refresh
      const sessionId = uuidv4();

      // Verificar se é um administrador do sistema
      const isSystemAdmin = this.checkIsSystemAdmin(user);

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
      const employee = user.employee?.[0];
      const companyId = employee?.company?.id;
      const planInfo = companyId
        ? await this.planControlService.getCompanyPlanInfo(companyId)
        : null;

      const subscription = planInfo?.planType ?? 'TRIAL';

      const payload = {
        username: user.email,
        sub: user.id,
        companyId: companyId || null,
        role: employee?.role?.id || null,
        isAdmin: employee?.role?.isAdmin ?? false,
        isSystemAdmin: false,
        employeeId: employee?.id || null,
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
      this.logger.error('Erro ao renovar token:', error);
      throw new HttpException('Erro ao renovar token: ' + error.message, 500);
    }
  }
}

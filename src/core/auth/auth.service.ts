import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PlanControlService } from '../plan/plan-control.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CompanySessionService } from '../subscriptions/checkout/company-session.service';
import { SessionAccessService } from './session-access.service';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { jwtConstants } from './constants';
import {
  JwtPayload,
  AuthUser,
  AuthUserRole,
  LoginResponse,
  RefreshClaims,
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
    private readonly sessionAccess: SessionAccessService,
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
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (user && (await argon2.verify(user.password, pass))) {
      const { ...result } = user;
      return result;
    }

    // Conta desativada por ter transferido o ambiente: quem saiu é informado
    // do motivo (com a senha certa), em vez de um login que só falha.
    if (!user) {
      const transferred = await this.sessionAccess.transferredAccess(
        normalizedEmail,
        pass,
      );
      if (transferred) {
        const date = transferred.acceptedAt.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });
        throw new UnauthorizedException({
          code: 'ACCESS_TRANSFERRED',
          message: `O ambiente ${transferred.companyName} foi transferido em ${date}, e esta conta não tem mais acesso a ele.`,
        });
      }
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
          pwd: this.sessionAccess.passwordStamp(user.password),
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
        pwd: this.sessionAccess.passwordStamp(user.password),
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
              logoDark: employee.company.logoDarkUrl,
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

  /**
   * Renova a sessão a partir das claims do refresh token. A conferência vem
   * antes (usuário ativo, senha não trocada desde a emissão, vínculo com a
   * empresa): sem ela, o refresh de 30 dias, que se renova a cada uso,
   * seguia emitindo tokens para quem trocou a senha ou foi inativado.
   */
  async refreshToken(claims: RefreshClaims): Promise<TokenResponse> {
    const pwd = await this.sessionAccess.assertRefreshable({
      sub: claims.userId,
      companyId: claims.companyId,
      employeeId: claims.employeeId,
      pwd: claims.pwd,
    });

    try {
      // Buscar usuário atualizado
      const user = await this.usersService.findOne(claims.userId);
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
          pwd,
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
        pwd,
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

import type { BillingSituation } from '../../subscriptions/checkout/company-session.service';
/**
 * Interfaces para tipar o AuthService — eliminando `any`
 */

/** Payload do JWT (access + refresh tokens) */
export interface JwtPayload {
  username: string;
  sub: string;
  companyId: string | null;
  role: string | null;
  isAdmin: boolean;
  isSystemAdmin: boolean;
  employeeId: string | null;
  subscription: string;
  /** Impressão da senha gravada (SessionAccessService.passwordStamp) */
  pwd?: string;
}

/** O que o JwtRefreshStrategy põe em req.user: as claims do refresh token */
export interface RefreshClaims {
  userId: string;
  companyId?: string | null;
  employeeId?: string | null;
  pwd?: string;
}

/** Estrutura de UserRole retornada pelo Prisma (include: { role: true }) */
export interface AuthUserRole {
  isSystemAdmin: boolean;
  role?: {
    id?: string;
    name?: string;
    isAdmin?: boolean;
    permissions?: string[];
  } | null;
}

/** Estrutura de Employee retornada pelo Prisma (select com company e role) */
export interface AuthEmployee {
  id: string;
  name?: string;
  avatarUrl?: string | null;
  role?: {
    id?: string;
    name?: string;
    isAdmin?: boolean;
    permissions?: string[];
  } | null;
  company?: {
    id: string;
    name: string;
    legalName?: string;
    logoUrl?: string | null;
    favIconUrl?: string | null;
    blockLevel?: string | null;
  };
}

/** Usuário autenticado (retorno de findByEmail / passport validate) */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  password: string;
  avatar?: string | null;
  employee: AuthEmployee[];
  userRole?: AuthUserRole[];
}

/** Resposta do login */
export interface LoginResponse {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  role: string | null;
  employeeId: string | null;
  isAdmin: boolean;
  isSystemAdmin: boolean;
  permissions: string[] | null;
  company: {
    id: string;
    name: string;
    legalName?: string;
    logo?: string | null;
    favicon?: string | null;
    subscription: string;
    /** Há assinatura paga ativa (contratação registrada). */
    subscriptionActive?: boolean;
    trialEndsAt?: Date | null;
    blockLevel: string;
    features: string[];
    limits: Record<string, number> | null;
    /** Situação da cobrança, para a faixa de aviso. */
    billing?: BillingSituation | null;
    /** Quem está logado é o titular da conta. */
    isOwner?: boolean;
  } | null;
  access_token: string;
  refresh_token: string;
  sessionId: string;
}

/** Resposta do refresh token */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  sessionId: string;
}

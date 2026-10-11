import type { TestCargo, TestPlanType } from '../options';

/**
 * Versão dos dados fictícios. Sobe a cada fixture nova e aparece na saída do
 * script, para o roteiro de teste dizer com que dados a conta foi aprovada.
 */
export const FIXTURES_VERSION = 'v1 (2026-10-11)';

export interface SellerProfileFixture {
  name: string;
  commission: number;
  maxDiscount: number;
  minValue: number;
}

/** Cargo com usuário fixo (o Administrador é o titular, do primeiro acesso). */
export interface RoleFixture {
  cargo: Exclude<TestCargo, 'admin'>;
  /** Nome do cargo na empresa: achado pelo nome e criado se faltar. */
  roleName: string;
  /** Setor do cargo, entre os setores padrão de toda empresa nova. */
  sectorName: string;
  /** Nome do colaborador e do usuário. */
  personName: string;
  /** Permissões `secao:item:acao`, regravadas a cada --garantir. */
  permissions: string[];
  sellerProfile?: SellerProfileFixture;
}

/** Cliente ou fornecedor fictício. Sem CPF/CNPJ: nenhum documento real. */
export interface PartyFixture {
  /** Parte do `legacyId` (`<família>:cliente:<ref>`). */
  ref: string;
  type: 'PERSON' | 'COMPANY';
  name: string;
  corporateName?: string;
  email?: string;
  mobile?: string;
  activity?: string;
  notes?: string;
}

/** Orçamento em aberto, criado pelo serviço de orçamento na série V1. */
export interface QuotationFixture {
  ref: string;
  /** `ref` do cliente da fixture. */
  clientRef: string;
  description: string;
}

/** O que uma conta do plano tem. Cumulativo: cada plano leva o do anterior. */
export interface PlanFixture {
  planType: TestPlanType;
  /** Usuários além do limite do plano (o Caixa é o 4º do LITE para cima). */
  additionalUsers: number;
  roles: RoleFixture[];
  clients: PartyFixture[];
  suppliers: PartyFixture[];
  quotations: QuotationFixture[];
}

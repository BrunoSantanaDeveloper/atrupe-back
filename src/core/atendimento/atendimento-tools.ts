import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  CompanySessionBlock,
  CompanySessionService,
} from '../subscriptions/checkout/company-session.service';
import type { AtendimentoKit } from './atendimento-kit';

import type {
  ProjectTool,
  ToolCall,
} from '../../../atendimento/base/server/bot-contract.mjs';

/** Até quanto a consulta espera o alinhamento com o Asaas (o robô espera 10 s). */
const GATEWAY_WAIT_MS = 5_000;

const BLOCK_LABEL: Record<string, string> = {
  NONE: 'nenhum',
  PARTIAL: 'parcial',
  FULL: 'total',
};

const BILLING_LABEL: Record<string, string> = {
  EM_DIA: 'em dia',
  ATRASADA: 'atrasada',
  BLOQUEADA: 'bloqueada por falta de pagamento',
  INATIVA: 'inativa',
};

/** A etapa pelo tipo do plano (Plan.planType). */
const ETAPA: Record<string, string> = {
  TRIAL: 'Teste',
  START: 'Start',
  LITE: 'Lite',
  PRO: 'Pro',
  ELITE: 'Elite',
  FULL: 'Full',
};

/** A chave do recurso de nota fiscal nos planos (FeatureGuard). */
const FISCAL_FEATURE = 'nota_fiscal';

/**
 * Os perfis de quem escreve, para o robô responder conforme a pessoa (Fase 1
 * do atendente Léo, 16/11/2026). O texto de cada um é escrito no Super Admin;
 * perfil sem texto segue só as instruções gerais.
 */
export const PERFIS_DECLARADOS = [
  {
    key: 'novo_contato',
    label: 'Novo contato',
    description:
      'Telefone fora do cadastro do Atrupe: entender a necessidade e levar ao teste grátis ou ao diagnóstico.',
  },
  {
    key: 'teste',
    label: 'Cliente em teste',
    description:
      'Empresa no teste grátis: ajudar a pessoa a usar o sistema enquanto o teste dura.',
  },
  {
    key: 'ativo',
    label: 'Cliente ativo',
    description:
      'Empresa com plano pago e em dia: passo a passo exato e, se pedir algo de outra etapa, o caminho da evolução.',
  },
  {
    key: 'inadimplente',
    label: 'Pagamento atrasado',
    description:
      'Empresa com cobrança vencida, ainda sem bloqueio: resolver a cobrança sem constranger.',
  },
  {
    key: 'bloqueado',
    label: 'Bloqueado',
    description:
      'Empresa com o sistema bloqueado por falta de pagamento: devolver o acesso pela cobrança.',
  },
  {
    key: 'cancelado',
    label: 'Cancelado',
    description:
      'Empresa inativa, com a assinatura cancelada ou com o teste grátis encerrado sem contratar: entender o motivo e oferecer a volta.',
  },
] as const;

export type PerfilChave = (typeof PERFIS_DECLARADOS)[number]['key'];

const labelOf = (key: PerfilChave) =>
  PERFIS_DECLARADOS.find((perfil) => perfil.key === key)?.label ?? key;

/** Quem pesa mais quando o telefone tem mais de uma empresa. */
const PRIORIDADE: PerfilChave[] = [
  'bloqueado',
  'inadimplente',
  'ativo',
  'teste',
  'cancelado',
];

type CompanyRow = {
  id: string;
  name: string;
  legalName: string | null;
  isActive?: boolean;
  createdAt?: Date;
};

const COMPANY_SELECT = {
  id: true,
  name: true,
  legalName: true,
  isActive: true,
  createdAt: true,
} as const;
const COMPANY_ORDER = [{ isActive: 'desc' as const }, { name: 'asc' as const }];

/**
 * Confirmação por código de quem escreve de um telefone fora do cadastro
 * (funcionário com o número pessoal): o código vai ao e-mail de acesso e, certo,
 * a conversa passa a usar o cadastro da pessoa por 7 dias.
 */
const CODE_TTL_MS = 10 * 60_000;
const BIND_TTL_MS = 7 * 86_400_000;
const MAX_CODES_PER_HOUR = 3;
const MAX_CODE_ATTEMPTS = 5;
const CODE_SENT_MESSAGE =
  'Se o e-mail estiver cadastrado no Atrupe, um código de 6 dígitos chega nele em instantes e vale 10 minutos. Peça o código à pessoa e confira com validar_codigo. Se não chegar, passe para a equipe.';
const VERIFICATION_KEY = (accountId: number, conversationId: number) =>
  `atendimento.verificacao.${accountId}.${conversationId}`;

type Verification = {
  sends?: string[];
  pendingUserId?: string | null;
  codeHash?: string | null;
  codeExpiresAt?: string | null;
  attempts?: number;
  boundUserId?: string | null;
  boundUntil?: string | null;
};

export type ConversationIds = { accountId?: number; conversationId?: number };

const dia = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString().slice(0, 10) : null;

const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * As consultas que o robô do suporte pode fazer aos dados do Atrupe. Cada uma
 * devolve só o que é da pessoa da conversa, achada pelo telefone do WhatsApp
 * (o da rota oficial vem verificado pela Meta) ou, para quem escreve de outro
 * número, confirmada por um código no e-mail de acesso; e o mínimo que
 * responde. Daqui sai também o perfil de quem escreve (perfilDoContato).
 */
@Injectable()
export class AtendimentoTools {
  private readonly logger = new Logger(AtendimentoTools.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companySession: CompanySessionService,
    private readonly mail: MailService,
  ) {}

  build(kit: AtendimentoKit): ProjectTool[] {
    return [
      {
        name: 'situacao_da_conta',
        description:
          'Situação da conta da própria pessoa no Atrupe: plano, teste gratuito, bloqueio e a cobrança em aberto (vencimento, valor e link de pagamento). A pessoa é achada pelo telefone do WhatsApp. Se ela tiver mais de uma empresa, a consulta devolve os nomes e você pergunta qual, consultando de novo com o nome em "empresa".',
        input_schema: {
          type: 'object',
          properties: {
            empresa: {
              type: 'string',
              description:
                'Nome da empresa, só quando a pessoa tem mais de uma no Atrupe',
            },
          },
        },
        run: (call) => this.accountSituation(kit, call),
      },
      {
        name: 'confirmar_acesso',
        description:
          'Para quem diz ser de uma empresa cliente do Atrupe, mas escreve de um telefone que não está no cadastro (por exemplo, um funcionário com o número pessoal): peça o e-mail de acesso ao Atrupe e chame esta consulta, que manda um código de 6 dígitos para esse e-mail. Diga que, se o e-mail estiver cadastrado, o código chega em instantes, e peça o código. Nunca diga se o e-mail existe ou não.',
        input_schema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'O e-mail que a pessoa usa para entrar no Atrupe',
            },
          },
          required: ['email'],
        },
        run: (call) => this.confirmAccess(call),
      },
      {
        name: 'validar_codigo',
        description:
          'Confere o código de 6 dígitos que a pessoa recebeu por e-mail depois de confirmar_acesso. Com o código certo, esta conversa passa a usar o cadastro dessa pessoa, e situacao_da_conta e o atendimento consideram a empresa dela.',
        input_schema: {
          type: 'object',
          properties: {
            codigo: {
              type: 'string',
              description: 'Os 6 dígitos que a pessoa recebeu',
            },
          },
          required: ['codigo'],
        },
        run: (call) => this.validateCode(call),
      },
      {
        name: 'link_da_mensalidade',
        description:
          'O link de pagamento da mensalidade em aberto de uma empresa cliente do Atrupe, para quem pedir, sem confirmação de acesso (decisão de 17/11/2026: pagar não compromete a conta). Use quando a pessoa pede o boleto, o Pix ou o link da mensalidade e não foi identificada pelo telefone: peça o CNPJ da empresa. Devolve só o nome da empresa, o vencimento, o valor e o link; nada de plano, situação ou outros dados.',
        input_schema: {
          type: 'object',
          properties: {
            cnpj: {
              type: 'string',
              description: 'O CNPJ da empresa, com ou sem pontuação',
            },
          },
          required: ['cnpj'],
        },
        run: (call) => this.paymentLink(call),
      },
    ];
  }

  /**
   * O link da mensalidade em aberto, pelo CNPJ, para quem pedir. Só o que a
   * página de pagamento já mostra: empresa, vencimento, valor e o link.
   */
  async paymentLink({ input }: ToolCall) {
    const cnpj = String(input?.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      return {
        ok: false,
        code: 'cnpj_invalido',
        message: 'Peça o CNPJ completo da empresa, com os 14 números.',
      };
    }
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id" FROM "companies" c
      WHERE c."cnpj" IS NOT NULL
        AND regexp_replace(c."cnpj", '\\D', '', 'g') = ${cnpj}
      ORDER BY c."isActive" DESC
      LIMIT 2`;
    if (!rows.length) {
      return {
        ok: false,
        code: 'cnpj_nao_encontrado',
        message:
          'Nenhuma empresa do Atrupe tem este CNPJ. Confira o número com a pessoa ou passe para a equipe.',
      };
    }
    const company = await this.prisma.company.findUnique({
      where: { id: rows[0].id },
      select: { id: true, name: true },
    });
    if (!company) return { ok: false, code: 'cnpj_nao_encontrado' };
    const charge = (await this.sessionOf(company.id)).billing.chargeInFocus;
    return {
      ok: true,
      empresa: company.name,
      mensalidade_em_aberto: charge
        ? {
            vencimento: charge.dueDate,
            valor_reais: charge.value,
            link_pagamento: charge.invoiceUrl,
          }
        : null,
    };
  }

  async accountSituation(
    kit: AtendimentoKit,
    { contact, input, accountId, conversationId }: ToolCall,
  ) {
    const companies = await this.companiesOf(kit, contact, {
      accountId,
      conversationId,
    });
    if (companies === 'sem_telefone') {
      return {
        ok: false,
        code: 'sem_telefone',
        message: 'Não deu para confirmar quem é a pessoa pelo telefone.',
      };
    }
    if (companies === 'varios_usuarios') {
      return {
        ok: false,
        code: 'telefone_em_varios_usuarios',
        message:
          'Este telefone está no cadastro de mais de um usuário; a equipe precisa confirmar quem é.',
      };
    }
    if (!companies.length) {
      return {
        ok: false,
        code: 'telefone_nao_cadastrado',
        message:
          'Nenhum usuário ou empresa do Atrupe tem este telefone no cadastro.',
      };
    }

    const wanted = normalize(input?.empresa);
    const chosen = wanted
      ? companies.filter(
          (company) =>
            normalize(company.name).includes(wanted) ||
            normalize(company.legalName).includes(wanted),
        )
      : companies;
    if (chosen.length !== 1) {
      return {
        ok: false,
        code: chosen.length ? 'varias_empresas' : 'empresa_nao_encontrada',
        empresas: companies.map((company) =>
          company.isActive === false
            ? `${company.name} (cancelada)`
            : company.name,
        ),
      };
    }

    const company = chosen[0];
    if (company.isActive === false) {
      // Empresa desativada: nada de cobrança nem de plano, só o que explica a
      // situação para a pessoa e para a equipe.
      return {
        ok: true,
        empresa: company.name,
        situacao: 'empresa cancelada',
        cliente_desde: dia(company.createdAt),
        cancelada_em: await this.lastCancellation(company.id),
      };
    }
    const session = await this.sessionOf(company.id);
    const charge = session.billing.chargeInFocus;
    return {
      ok: true,
      empresa: company.name,
      plano: session.plan.name,
      etapa: ETAPA[session.plan.name] ?? session.plan.name,
      recurso_fiscal: session.plan.features.includes(FISCAL_FEATURE),
      cliente_desde: dia(company.createdAt),
      plano_ativo: session.plan.active,
      teste_gratis_ate: session.plan.active ? null : session.plan.trialEndsAt,
      bloqueio: BLOCK_LABEL[session.blockLevel] ?? session.blockLevel,
      cobranca: BILLING_LABEL[session.billing.situation] ?? 'desconhecida',
      dias_em_atraso: session.billing.daysOverdue,
      contratacao_aguardando_pagamento: session.billing.activationPending,
      mudanca_de_plano_aguardando_pagamento: session.billing.evolutionPending,
      cobranca_em_aberto: charge
        ? {
            vencimento: charge.dueDate,
            valor_reais: charge.value,
            forma: charge.billingType,
            link_pagamento: charge.invoiceUrl,
          }
        : null,
    };
  }

  /**
   * Quem escreve, para o robô responder conforme a pessoa: o perfil e o que
   * ele precisa saber dela, sem valores nem links de cobrança (esses vêm da
   * consulta situacao_da_conta, quando a IA pede). Telefone em mais de um
   * usuário fica sem perfil: a equipe confirma quem é.
   */
  async perfilDoContato(
    kit: AtendimentoKit,
    contact: unknown,
    ids: ConversationIds = {},
  ): Promise<{
    profile: PerfilChave | null;
    label?: string;
    facts?: Record<string, string | number | boolean | null>;
  }> {
    const companies = await this.companiesOf(kit, contact, ids);
    if (companies === 'sem_telefone' || companies === 'varios_usuarios') {
      return { profile: null };
    }
    if (!companies.length) {
      return { profile: 'novo_contato', label: labelOf('novo_contato') };
    }

    const perfis = await Promise.all(
      companies.slice(0, 5).map((company) => this.perfilDaEmpresa(company)),
    );
    const escolhido = [...perfis].sort(
      (a, b) => PRIORIDADE.indexOf(a.profile) - PRIORIDADE.indexOf(b.profile),
    )[0];
    const facts: Record<string, string | number | boolean | null> = {
      ...escolhido.facts,
      identificado_por: (await this.boundUser(ids))
        ? 'código enviado ao e-mail de acesso'
        : 'telefone do cadastro',
    };
    if (companies.length > 1) {
      facts.empresas = companies.map((company) => company.name).join('; ');
      facts.observacao =
        'A pessoa tem mais de uma empresa no Atrupe: pergunte de qual ela fala antes de tratar de uma delas.';
    }
    return {
      profile: escolhido.profile,
      label: labelOf(escolhido.profile),
      facts,
    };
  }

  private async perfilDaEmpresa(company: CompanyRow): Promise<{
    profile: PerfilChave;
    facts: Record<string, string | number | boolean | null>;
  }> {
    const base = {
      empresa: company.name,
      cliente_desde: dia(company.createdAt),
    };
    if (company.isActive === false) {
      return {
        profile: 'cancelado',
        facts: {
          ...base,
          situacao: 'empresa desativada',
          cancelada_em: await this.lastCancellation(company.id),
        },
      };
    }
    // Sem a conferência com o Asaas: o perfil vem a cada mensagem e não pode
    // esperar o gateway. A consulta situacao_da_conta confere quando a IA pede.
    const session = await this.companySession.build(company.id);
    const comum = {
      ...base,
      etapa: ETAPA[session.plan.name] ?? session.plan.name,
      recurso_fiscal: session.plan.features.includes(FISCAL_FEATURE),
    };
    if (!session.plan.active) {
      const fim = session.plan.trialEndsAt
        ? new Date(session.plan.trialEndsAt)
        : null;
      if (fim && fim.getTime() > Date.now()) {
        return {
          profile: 'teste',
          facts: {
            ...comum,
            teste_termina_em: dia(fim),
            teste_dias_restantes: Math.max(
              0,
              Math.ceil((fim.getTime() - Date.now()) / 86_400_000),
            ),
          },
        };
      }
      const cancelada = await this.lastCancellation(company.id);
      return {
        profile: 'cancelado',
        facts: {
          ...comum,
          situacao: cancelada
            ? 'assinatura cancelada'
            : 'teste grátis encerrado sem contratar',
          cancelada_em: cancelada,
          teste_terminou_em: dia(fim),
        },
      };
    }
    const cobranca = BILLING_LABEL[session.billing.situation] ?? 'desconhecida';
    const profile: PerfilChave =
      session.billing.situation === 'INATIVA' ||
      session.billing.situation === 'BLOQUEADA'
        ? 'bloqueado'
        : session.billing.situation === 'ATRASADA'
          ? 'inadimplente'
          : 'ativo';
    return {
      profile,
      facts: {
        ...comum,
        cobranca,
        dias_em_atraso: session.billing.daysOverdue || null,
        contratacao_aguardando_pagamento: session.billing.activationPending,
      },
    };
  }

  /** Quando a última assinatura paga foi cancelada; nula se nunca foi. */
  private async lastCancellation(companyId: string): Promise<string | null> {
    const canceled = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'CANCELED',
        plan: { planType: { not: 'TRIAL' } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    return dia(canceled?.updatedAt);
  }

  /**
   * As empresas da pessoa do telefone, ativas primeiro: as dos usuários com
   * esse telefone (titularidade ou vínculo de colaborador ativo) e, sem
   * usuário, as empresas com esse telefone no cadastro. Empresa desativada
   * entra, para o perfil cancelado; usuário desativado só conta quando não há
   * um ativo com o mesmo telefone.
   */
  private async companiesByPhone(
    phones: string[],
  ): Promise<CompanyRow[] | 'varios_usuarios'> {
    const users = await this.prisma.$queryRaw<
      Array<{ id: string; isActive?: boolean }>
    >`
      SELECT u."id", u."isActive" FROM "users" u
      WHERE u."phone" IS NOT NULL
        AND (regexp_replace(u."phone", '\\D', '', 'g') = ANY(${phones}::text[])
          OR '55' || regexp_replace(u."phone", '\\D', '', 'g') = ANY(${phones}::text[]))
      ORDER BY u."isActive" DESC
      LIMIT 5`;
    const active = users.filter((user) => user.isActive !== false);
    const candidates = active.length ? active : users;
    if (candidates.length > 1) return 'varios_usuarios';

    if (candidates.length === 1) {
      return this.companiesOfUser(candidates[0].id);
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id" FROM "companies" c
      WHERE c."phone" IS NOT NULL
        AND (regexp_replace(c."phone", '\\D', '', 'g') = ANY(${phones}::text[])
          OR '55' || regexp_replace(c."phone", '\\D', '', 'g') = ANY(${phones}::text[]))
      LIMIT 20`;
    if (!rows.length) return [];
    return this.prisma.company.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: COMPANY_SELECT,
      orderBy: COMPANY_ORDER,
    });
  }

  /** As empresas de um usuário: titularidade ou vínculo de colaborador ativo. */
  private companiesOfUser(userId: string): Promise<CompanyRow[]> {
    return this.prisma.company.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          { employees: { some: { userId, isActive: true } } },
        ],
      },
      select: COMPANY_SELECT,
      orderBy: COMPANY_ORDER,
      take: 20,
    });
  }

  /**
   * As empresas de quem escreve: as do usuário confirmado por código nesta
   * conversa, se houver; senão, as do telefone do WhatsApp.
   */
  private async companiesOf(
    kit: AtendimentoKit,
    contact: unknown,
    ids: ConversationIds,
  ): Promise<CompanyRow[] | 'varios_usuarios' | 'sem_telefone'> {
    const bound = await this.boundUser(ids);
    if (bound) return this.companiesOfUser(bound);
    // A rota contact manda phone; as consultas, phone_number (como o
    // Chatwoot). O identifier é o do WhatsApp Web (5547...@c.us).
    const c = (contact ?? {}) as {
      phone?: string | null;
      phone_number?: string | null;
      identifier?: string | null;
    };
    const phones = kit.phone.brPhoneVariants(
      kit.phone.contactPhone({
        phone_number: c.phone_number ?? c.phone ?? null,
        identifier: c.identifier ?? null,
      }),
    );
    if (!phones.length) return 'sem_telefone';
    return this.companiesByPhone(phones);
  }

  /** O usuário confirmado por código nesta conversa, enquanto vale. */
  private async boundUser({
    accountId,
    conversationId,
  }: ConversationIds): Promise<string | null> {
    if (!accountId || !conversationId) return null;
    const state = await this.readVerification(accountId, conversationId);
    if (!state?.boundUserId || !state.boundUntil) return null;
    return new Date(state.boundUntil).getTime() > Date.now()
      ? state.boundUserId
      : null;
  }

  /**
   * Manda o código ao e-mail de acesso. A resposta é a mesma com ou sem
   * cadastro, para a conversa não servir de teste de e-mail: quem não recebe
   * o código pede a equipe.
   */
  async confirmAccess({ accountId, conversationId, input }: ToolCall) {
    const email = String(input?.email ?? '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        ok: false,
        code: 'email_invalido',
        message: 'Peça o e-mail completo que a pessoa usa para entrar.',
      };
    }
    if (!accountId || !conversationId) {
      return { ok: false, code: 'sem_conversa' };
    }
    const now = Date.now();
    const state =
      (await this.readVerification(accountId, conversationId)) ?? {};
    const recent = (state.sends ?? []).filter(
      (at) => now - new Date(at).getTime() < 3_600_000,
    );
    if (recent.length >= MAX_CODES_PER_HOUR) {
      return {
        ok: false,
        code: 'muitos_envios',
        message:
          'Já foram enviados 3 códigos nesta conversa na última hora. Passe a conversa para a equipe.',
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true, email: true },
    });
    const sends = [...recent, new Date(now).toISOString()];
    if (!user) {
      await this.writeVerification(accountId, conversationId, {
        ...state,
        sends,
        pendingUserId: null,
        codeHash: null,
        codeExpiresAt: null,
      });
      return { ok: true, message: CODE_SENT_MESSAGE };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.writeVerification(accountId, conversationId, {
      ...state,
      sends,
      pendingUserId: user.id,
      codeHash: this.codeHash(accountId, conversationId, code),
      codeExpiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      attempts: 0,
    });
    try {
      await this.mail.sendEmail(
        user.email,
        'Código para o atendimento do Atrupe',
        'atendimento-codigo',
        { name: user.name, code, minutes: CODE_TTL_MS / 60_000 },
        [],
      );
    } catch (error) {
      this.logger.warn(
        `Código do atendimento não saiu (conversa ${conversationId}): ${(error as Error).message}`,
      );
    }
    return { ok: true, message: CODE_SENT_MESSAGE };
  }

  /** Confere o código; certo, a conversa passa a usar o cadastro da pessoa. */
  async validateCode({ accountId, conversationId, input }: ToolCall) {
    if (!accountId || !conversationId) {
      return { ok: false, code: 'sem_conversa' };
    }
    const code = String(input?.codigo ?? '').replace(/\D/g, '');
    const state = await this.readVerification(accountId, conversationId);
    if (
      !state?.codeHash ||
      !state.pendingUserId ||
      !state.codeExpiresAt ||
      new Date(state.codeExpiresAt).getTime() < Date.now()
    ) {
      return {
        ok: false,
        code: 'sem_codigo_valido',
        message:
          'Não há código válido nesta conversa: confirme o e-mail de novo com confirmar_acesso.',
      };
    }
    if ((state.attempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      return {
        ok: false,
        code: 'tentativas_esgotadas',
        message: 'O código errou vezes demais. Passe a conversa para a equipe.',
      };
    }
    const expected = Buffer.from(state.codeHash, 'hex');
    const given = Buffer.from(
      this.codeHash(accountId, conversationId, code),
      'hex',
    );
    if (
      code.length !== 6 ||
      expected.length !== given.length ||
      !timingSafeEqual(expected, given)
    ) {
      const attempts = (state.attempts ?? 0) + 1;
      await this.writeVerification(accountId, conversationId, {
        ...state,
        attempts,
      });
      return {
        ok: false,
        code: 'codigo_errado',
        tentativas_restantes: Math.max(0, MAX_CODE_ATTEMPTS - attempts),
      };
    }

    await this.writeVerification(accountId, conversationId, {
      sends: state.sends ?? [],
      boundUserId: state.pendingUserId,
      boundUntil: new Date(Date.now() + BIND_TTL_MS).toISOString(),
    });
    const companies = await this.companiesOfUser(state.pendingUserId);
    return {
      ok: true,
      message:
        'Acesso confirmado: nesta conversa, as consultas usam o cadastro dessa pessoa.',
      empresas: companies.map((company) => company.name),
    };
  }

  private codeHash(accountId: number, conversationId: number, code: string) {
    // O segredo do robô já existe só no servidor; o código vale 10 minutos.
    const secret = process.env.SUPPORT_BOT_SECRET?.trim() || 'atendimento';
    return createHmac('sha256', secret)
      .update(`${accountId}:${conversationId}:${code}`)
      .digest('hex');
  }

  private async readVerification(
    accountId: number,
    conversationId: number,
  ): Promise<Verification | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: VERIFICATION_KEY(accountId, conversationId) },
    });
    return (row?.value as Verification | null) ?? null;
  }

  private async writeVerification(
    accountId: number,
    conversationId: number,
    value: Verification,
  ) {
    const key = VERIFICATION_KEY(accountId, conversationId);
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }

  /**
   * A situação conferida com o Asaas quando há cobrança em foco (quem acabou
   * de pagar vê pago), sem passar do prazo do robô: demorou, vale o banco.
   */
  private async sessionOf(companyId: string): Promise<CompanySessionBlock> {
    let timer: NodeJS.Timeout | undefined;
    const fallback = new Promise<'tarde'>((resolve) => {
      timer = setTimeout(() => resolve('tarde'), GATEWAY_WAIT_MS);
    });
    const checked = this.companySession
      .buildWithGatewayCheck(companyId)
      .catch((error) => {
        this.logger.warn(
          `Situação da empresa ${companyId} sem conferência: ${error.message}`,
        );
        return null;
      });
    const first = await Promise.race([checked, fallback]).finally(() =>
      clearTimeout(timer),
    );
    return first && first !== 'tarde'
      ? first
      : this.companySession.build(companyId);
  }
}

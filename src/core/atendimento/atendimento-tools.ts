import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
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

const normalize = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * As consultas que o robô do suporte pode fazer aos dados do Atrupe. Cada uma
 * devolve só o que é da pessoa da conversa, achada pelo telefone do WhatsApp
 * (o da rota oficial vem verificado pela Meta), e o mínimo que responde.
 */
@Injectable()
export class AtendimentoTools {
  private readonly logger = new Logger(AtendimentoTools.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companySession: CompanySessionService,
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
    ];
  }

  async accountSituation(kit: AtendimentoKit, { contact, input }: ToolCall) {
    const phones = kit.phone.brPhoneVariants(kit.phone.contactPhone(contact));
    if (!phones.length) {
      return {
        ok: false,
        code: 'sem_telefone',
        message: 'Não deu para confirmar quem é a pessoa pelo telefone.',
      };
    }

    const companies = await this.companiesByPhone(phones);
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
          'Nenhum usuário ou empresa ativa do Atrupe tem este telefone no cadastro.',
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
        empresas: companies.map((company) => company.name),
      };
    }

    const company = chosen[0];
    const session = await this.sessionOf(company.id);
    const charge = session.billing.chargeInFocus;
    return {
      ok: true,
      empresa: company.name,
      plano: session.plan.name,
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
   * As empresas ativas da pessoa do telefone: as dos usuários com esse
   * telefone (vínculo de colaborador ativo ou titularidade) e, sem usuário,
   * as empresas com esse telefone no cadastro.
   */
  private async companiesByPhone(
    phones: string[],
  ): Promise<
    | Array<{ id: string; name: string; legalName: string | null }>
    | 'varios_usuarios'
  > {
    const users = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT u."id" FROM "users" u
      WHERE u."isActive" = true AND u."phone" IS NOT NULL
        AND (regexp_replace(u."phone", '\\D', '', 'g') = ANY(${phones}::text[])
          OR '55' || regexp_replace(u."phone", '\\D', '', 'g') = ANY(${phones}::text[]))
      LIMIT 3`;
    if (users.length > 1) return 'varios_usuarios';

    const select = { id: true, name: true, legalName: true } as const;
    if (users.length === 1) {
      const userId = users[0].id;
      return this.prisma.company.findMany({
        where: {
          isActive: true,
          OR: [
            { ownerUserId: userId },
            { employees: { some: { userId, isActive: true } } },
          ],
        },
        select,
        orderBy: { name: 'asc' },
        take: 20,
      });
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c."id" FROM "companies" c
      WHERE c."isActive" = true AND c."phone" IS NOT NULL
        AND (regexp_replace(c."phone", '\\D', '', 'g') = ANY(${phones}::text[])
          OR '55' || regexp_replace(c."phone", '\\D', '', 'g') = ANY(${phones}::text[]))
      LIMIT 20`;
    if (!rows.length) return [];
    return this.prisma.company.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select,
      orderBy: { name: 'asc' },
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

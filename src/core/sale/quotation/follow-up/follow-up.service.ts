import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MailerService } from '@nestjs-modules/mailer';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { FollowUpSettingsDto, RegisterContactDto } from './follow-up.dto';

/**
 * Acompanhamento comercial, CRM fase 2 (27/10/2026, área 13 das regras):
 * registrar contato, a linha do tempo da negociação e do cliente, os totais
 * da aba Aguardando, a configuração (modelos de mensagem, e-mail diário) e
 * o e-mail diário ao vendedor. Sem kanban: tudo mora nas telas que existem.
 */

type Actor = { userId: string; companyId: string; name?: string | null };

/** Proposta vencendo: até 2 dias para o fim da validade (CRM-2). */
export const EXPIRING_DAYS = 2;

export const DEFAULT_TEMPLATES = {
  templateProposalSent:
    'Olá, {cliente}! Segue a proposta {numero} no valor de {valor}, válida até {validade}. Qualquer dúvida, estou à disposição. {vendedor} · {empresa}',
  templateValidity:
    'Olá, {cliente}! A proposta {numero} vence em {validade}. Posso garantir o valor de {valor} se fecharmos até lá. {vendedor} · {empresa}',
  templateResume:
    'Olá, {cliente}! Passando para saber se conseguiu avaliar a proposta {numero}. Posso ajudar em algo? {vendedor} · {empresa}',
};

/** Onde o orçamento ainda está em negociação. */
export const NEGOTIATING: Prisma.QuotationWhereInput = {
  isActive: true,
  status: { in: ['OPEN', 'DONE'] },
};

/** "Para retomar": próximo contato até hoje, ou proposta vencendo (CRM-2). */
export function dueWhere(now = new Date()): Prisma.QuotationWhereInput {
  return {
    ...NEGOTIATING,
    OR: [
      { nextContactAt: { lte: endOfDay(now) } },
      {
        status: 'DONE',
        dueDate: {
          gte: startOfDay(now),
          lte: endOfDay(addDays(now, EXPIRING_DAYS)),
        },
      },
    ],
  };
}

export function expiringWhere(now = new Date()): Prisma.QuotationWhereInput {
  return {
    isActive: true,
    status: 'DONE',
    dueDate: {
      gte: startOfDay(now),
      lte: endOfDay(addDays(now, EXPIRING_DAYS)),
    },
  };
}

/** O texto do cadastro entra no HTML do e-mail como texto, não como marcação. */
export function escapeHtml(value: string | null | undefined) {
  return (value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
}

export function noContactWhere(): Prisma.QuotationWhereInput {
  return { isActive: true, status: 'DONE', nextContactAt: null };
}

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  /* ------------------------------------------------------- contatos */

  async registerContact(
    actor: Actor,
    quotationId: string,
    dto: RegisterContactDto,
  ) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId: actor.companyId },
      select: { id: true, clientId: true, status: true },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    if (dto.tagId) {
      const tag = await this.prisma.quotationTag.findFirst({
        where: { id: dto.tagId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!tag) throw new BadRequestException('Marcador não encontrado');
    }
    const userName =
      actor.name ??
      (
        await this.prisma.user.findUnique({
          where: { id: actor.userId },
          select: { name: true },
        })
      )?.name ??
      null;

    const quotationData: Prisma.QuotationUpdateInput = {};
    if (dto.nextContactAt !== undefined) {
      quotationData.nextContactAt = dto.nextContactAt
        ? new Date(dto.nextContactAt)
        : null;
    }
    if (dto.nextContactNote !== undefined) {
      quotationData.nextContactNote = dto.nextContactNote?.trim() || null;
    }
    if (dto.tagId !== undefined) {
      quotationData.tag = dto.tagId
        ? { connect: { id: dto.tagId } }
        : { disconnect: true };
    }

    const [contact] = await this.prisma.$transaction([
      this.prisma.quotationContact.create({
        data: {
          companyId: actor.companyId,
          quotationId,
          clientId: quotation.clientId,
          userId: actor.userId,
          userName,
          channel: dto.channel ?? 'WHATSAPP',
          outcome: dto.outcome,
          note: dto.note?.trim() || null,
          at: dto.at ? new Date(dto.at) : new Date(),
        },
      }),
      ...(Object.keys(quotationData).length
        ? [
            this.prisma.quotation.update({
              where: { id: quotationId },
              data: quotationData,
            }),
          ]
        : []),
    ]);
    const updated = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { nextContactAt: true, nextContactNote: true, tagId: true },
    });
    return { contact, ...updated };
  }

  /**
   * Linha do tempo da negociação: os contatos registrados e os eventos do
   * histórico do orçamento (criado, enviado, rejeitado, aprovado…), juntos
   * e do mais novo ao mais antigo (CRM-1).
   */
  async timeline(companyId: string, quotationId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, companyId },
      select: { id: true },
    });
    if (!quotation) throw new NotFoundException('Orçamento não encontrado');
    const [contacts, events] = await Promise.all([
      this.prisma.quotationContact.findMany({
        where: { quotationId },
        orderBy: { at: 'desc' },
      }),
      this.prisma.quotationHistory.findMany({
        where: { quotationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          description: true,
          createdAt: true,
          createdByName: true,
        },
      }),
    ]);
    const rows = [
      ...contacts.map((c) => ({
        kind: 'contact' as const,
        id: c.id,
        at: c.at.toISOString(),
        channel: c.channel,
        outcome: c.outcome,
        note: c.note,
        by: c.userName,
      })),
      ...events.map((e) => ({
        kind: 'event' as const,
        id: e.id,
        at: e.createdAt.toISOString(),
        action: e.action,
        description: e.description,
        by: e.createdByName,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return { contacts: contacts.length, items: rows };
  }

  /**
   * O cliente visto pelo acompanhamento (CRM-4): a linha do tempo dos
   * contatos de todos os orçamentos, a última compra e há quantos dias.
   */
  async clientTimeline(companyId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, companyId },
      select: { id: true, name: true, mobile: true, phone: true },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado');
    const [contacts, lastPurchase, open] = await Promise.all([
      this.prisma.quotationContact.findMany({
        where: { clientId, companyId },
        orderBy: { at: 'desc' },
        take: 200,
        include: {
          quotation: {
            select: {
              id: true,
              quotationNumber: true,
              description: true,
              status: true,
              series: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.quotation.findFirst({
        where: { clientId, companyId, status: 'APPROVED', isActive: true },
        orderBy: { approvedAt: 'desc' },
        select: {
          id: true,
          approvedAt: true,
          totalValue: true,
          quotationNumber: true,
          description: true,
          series: { select: { code: true } },
        },
      }),
      this.prisma.quotation.count({
        where: { clientId, companyId, ...NEGOTIATING },
      }),
    ]);
    const days = lastPurchase?.approvedAt
      ? Math.floor((Date.now() - lastPurchase.approvedAt.getTime()) / 86400000)
      : null;
    return {
      client,
      lastPurchase: lastPurchase
        ? {
            quotationId: lastPurchase.id,
            reference: `${lastPurchase.quotationNumber ?? ''}-${lastPurchase.series?.code ?? ''}`,
            description: lastPurchase.description,
            at: lastPurchase.approvedAt?.toISOString() ?? null,
            value: lastPurchase.totalValue,
            daysSince: days,
          }
        : null,
      openNegotiations: open,
      items: contacts.map((c) => ({
        id: c.id,
        at: c.at.toISOString(),
        channel: c.channel,
        outcome: c.outcome,
        note: c.note,
        by: c.userName,
        quotation: {
          id: c.quotation.id,
          reference: `${c.quotation.quotationNumber ?? ''}-${c.quotation.series?.code ?? ''}`,
          description: c.quotation.description,
          status: c.quotation.status,
        },
      })),
    };
  }

  /* --------------------------------------------------------- totais */

  /**
   * Os números da aba Aguardando e do contador do menu (CRM-2, CRM-3), no
   * escopo do vendedor quando ele só vê os próprios orçamentos.
   */
  async summary(companyId: string, sellerId?: string) {
    const scope = { companyId, ...(sellerId ? { sellerId } : {}) };
    const now = new Date();
    const [due, overdue, expiring, noContact, waiting] = await Promise.all([
      this.prisma.quotation.count({ where: { ...scope, ...dueWhere(now) } }),
      this.prisma.quotation.count({
        where: {
          ...scope,
          ...NEGOTIATING,
          nextContactAt: { lt: startOfDay(now) },
        },
      }),
      this.prisma.quotation.count({
        where: { ...scope, ...expiringWhere(now) },
      }),
      this.prisma.quotation.count({ where: { ...scope, ...noContactWhere() } }),
      this.prisma.quotation.count({
        where: { ...scope, isActive: true, status: 'DONE' },
      }),
    ]);
    return { due, overdue, expiring, noContact, waiting };
  }

  /* --------------------------------------------------- configuração */

  async settings(companyId: string) {
    const saved = await this.prisma.followUpSettings.findUnique({
      where: { companyId },
    });
    return {
      templateProposalSent:
        saved?.templateProposalSent ?? DEFAULT_TEMPLATES.templateProposalSent,
      templateValidity:
        saved?.templateValidity ?? DEFAULT_TEMPLATES.templateValidity,
      templateResume: saved?.templateResume ?? DEFAULT_TEMPLATES.templateResume,
      dailyEmail: saved?.dailyEmail ?? false,
      dailyEmailHour: saved?.dailyEmailHour ?? 8,
      inactiveDays: saved?.inactiveDays ?? 90,
    };
  }

  async saveSettings(companyId: string, dto: FollowUpSettingsDto) {
    const data = {
      templateProposalSent: dto.templateProposalSent?.trim() || null,
      templateValidity: dto.templateValidity?.trim() || null,
      templateResume: dto.templateResume?.trim() || null,
      dailyEmail: dto.dailyEmail,
      dailyEmailHour: dto.dailyEmailHour,
      inactiveDays: dto.inactiveDays,
    };
    await this.prisma.followUpSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return this.settings(companyId);
  }

  /* --------------------------------------------------- e-mail diário */

  /**
   * E-mail diário ao vendedor (CRM-3): a lista do dia, na hora configurada
   * pela empresa (hora de São Paulo). Roda de hora em hora; cada empresa
   * recebe na hora dela. Falha fica no log, sem derrubar as outras.
   */
  @Cron('5 * * * *', { name: 'follow-up-daily-email' })
  async sendDailyEmails(now = new Date()) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/Sao_Paulo',
      }).format(now),
    );
    const companies = await this.prisma.followUpSettings.findMany({
      where: { dailyEmail: true, dailyEmailHour: hour },
      select: { companyId: true },
    });
    for (const { companyId } of companies) {
      try {
        await this.sendDailyEmailFor(companyId, now);
      } catch (error) {
        this.logger.error(
          `E-mail diário de acompanhamento da empresa ${companyId}: ${error?.message}`,
        );
      }
    }
  }

  private async sendDailyEmailFor(companyId: string, now: Date) {
    const rows = await this.prisma.quotation.findMany({
      where: { companyId, ...dueWhere(now) },
      select: {
        quotationNumber: true,
        description: true,
        totalValue: true,
        dueDate: true,
        nextContactAt: true,
        nextContactNote: true,
        series: { select: { code: true } },
        client: { select: { name: true } },
        seller: {
          select: {
            id: true,
            name: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
      orderBy: [{ nextContactAt: 'asc' }, { dueDate: 'asc' }],
    });
    const bySeller = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = bySeller.get(row.seller.id) ?? [];
      list.push(row);
      bySeller.set(row.seller.id, list);
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    for (const list of bySeller.values()) {
      const email = list[0].seller.user?.email;
      if (!email) continue;
      const lines = list
        .map((q) => {
          const ref = `${q.quotationNumber ?? ''}-${q.series?.code ?? ''}`;
          const when = q.nextContactAt
            ? `contato ${q.nextContactAt.toLocaleDateString('pt-BR')}`
            : q.dueDate
              ? `vence ${q.dueDate.toLocaleDateString('pt-BR')}`
              : '';
          // O valor do orçamento é em centavos
          const value = ((q.totalValue ?? 0) / 100).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
          return `<li><strong>${escapeHtml(ref)}</strong> · ${escapeHtml(q.client?.name ?? 'Cliente não informado')} · ${value} · ${when}${q.nextContactNote ? ` — ${escapeHtml(q.nextContactNote)}` : ''}</li>`;
        })
        .join('');
      await this.mailer.sendMail({
        to: email,
        subject: `Acompanhamento de hoje: ${list.length} ${list.length === 1 ? 'orçamento' : 'orçamentos'} para retomar`,
        html: `<p>Olá, ${escapeHtml(list[0].seller.name ?? list[0].seller.user?.name)}!</p><p>Estes orçamentos pedem contato hoje${company?.name ? ` (${escapeHtml(company.name)})` : ''}:</p><ul>${lines}</ul><p>Abra a aba Aguardando em Vendas › Orçamentos para registrar os contatos.</p>`,
      });
    }
  }
}

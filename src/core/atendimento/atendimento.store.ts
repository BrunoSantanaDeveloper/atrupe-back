import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { MailService } from '../mail/mail.service';

import type { GapEventPayload } from '../../../atendimento/base/server/bot-contract.mjs';
import type { WhatsappAlert } from '../../../atendimento/base/server/health.mjs';
import type { SupportState } from '../../../atendimento/base/server/provision.mjs';
import type { PlatformSettings } from '../../../atendimento/base/shared/settings.mjs';

/** No modelo "plataforma", o único cliente do atendimento é o próprio Atrupe. */
export const PLATFORM_TENANT = 'plataforma';

const STATE_KEY = (tenantId: string) => `atendimento.estado.${tenantId}`;
const PLATFORM_SETTINGS_KEY = 'atendimento.robo.plataforma';

/** A equipe do suporte da plataforma: os superadmins ativos. */
const ACTIVE_SUPERADMIN = {
  isActive: true,
  userRole: { some: { isSystemAdmin: true } },
};

const WHATSAPP_SCREEN = '/admin/atendimento/whatsapp';

export interface StoredSuggestion {
  id: string;
  tenantId: string;
  owner: 'plataforma' | 'cliente';
  conversationId: number;
  q: string;
  a: string;
  why: string;
  at: string;
}

/** Quem a sessão diz que é, conferido no banco na hora. */
export interface AtendimentoPerson {
  key: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
  isSupportStaff: boolean;
  canConfigure: boolean;
}

/**
 * Onde o atendimento fica guardado no banco do Atrupe.
 *
 * - O estado da conta no Chatwoot (ids e os tokens da conta de serviço e do
 *   robô) vai em `system_settings`, inteiro cifrado com o `EncryptionService`;
 *   só o `account_id` fica aberto, para achar o cliente pelo aviso do robô.
 * - A camada da plataforma (o contexto do robô), que só o superadmin edita,
 *   também vai em `system_settings`.
 * - Sugestões de conhecimento e passagens para a equipe têm tabela própria.
 */
@Injectable()
export class AtendimentoStore {
  private readonly logger = new Logger(AtendimentoStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly mail: MailService,
  ) {}

  private aad(tenantId: string) {
    return {
      table: 'system_settings',
      recordId: STATE_KEY(tenantId),
      companyId: 'atendimento',
      field: 'value',
      scope: 'GLOBAL' as const,
    };
  }

  async loadState(tenantId: string): Promise<SupportState | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: STATE_KEY(tenantId) },
    });
    const envelope = (row?.value as { envelope?: string } | null)?.envelope;
    if (!envelope) return null;
    return JSON.parse(
      this.encryption.decrypt(envelope, this.aad(tenantId)),
    ) as SupportState;
  }

  async saveState(tenantId: string, state: SupportState): Promise<void> {
    const value = {
      account_id: state.account_id ?? null,
      envelope: this.encryption.encrypt(
        JSON.stringify(state),
        this.aad(tenantId),
      ),
    };
    await this.prisma.systemSetting.upsert({
      where: { key: STATE_KEY(tenantId) },
      create: { key: STATE_KEY(tenantId), value },
      update: { value },
    });
  }

  /** O cliente dono da conta do Chatwoot; no modelo plataforma, só um. */
  async tenantByAccount(accountId: number): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: STATE_KEY(PLATFORM_TENANT) },
    });
    const stored = (row?.value as { account_id?: number } | null)?.account_id;
    return Number.isInteger(accountId) && stored === accountId
      ? PLATFORM_TENANT
      : null;
  }

  async loadPlatformSettings(): Promise<PlatformSettings | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: PLATFORM_SETTINGS_KEY },
    });
    return (row?.value as unknown as PlatformSettings) ?? null;
  }

  async savePlatformSettings(settings: PlatformSettings): Promise<void> {
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key: PLATFORM_SETTINGS_KEY },
      create: { key: PLATFORM_SETTINGS_KEY, value },
      update: { value },
    });
  }

  /**
   * Quem pode atender hoje: no suporte da plataforma, a equipe é a dos
   * superadmins ativos. A conferência diária tira do Chatwoot quem saiu daqui.
   */
  async listPanelPeople(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: ACTIVE_SUPERADMIN,
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  /**
   * As mesmas pessoas de listPanelPeople, com nome e e-mail, para escolher
   * quem entra num grupo da equipe.
   */
  async teamPeople(): Promise<
    Array<{ key: string; name: string; email: string }>
  > {
    const users = await this.prisma.user.findMany({
      where: ACTIVE_SUPERADMIN,
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return users.map((user) => ({
      key: user.id,
      name: user.name,
      email: user.email,
    }));
  }

  /**
   * Avisa os superadmins ativos que o WhatsApp parou, pede atenção ou voltou,
   * pelo e-mail, o canal de avisos que o Atrupe tem. Lança quando ninguém
   * recebeu: a conferência não grava a memória e o aviso volta na próxima. Quem
   * falhou sozinho não faz repetir: um endereço recusado para sempre mandaria
   * o mesmo e-mail a todos a cada 15 minutos.
   */
  async alertWhatsapp(
    _tenantId: string,
    alerts: WhatsappAlert[],
  ): Promise<void> {
    const people = await this.prisma.user.findMany({
      where: ACTIVE_SUPERADMIN,
      select: { email: true, name: true },
    });
    if (!people.length) {
      throw new Error('Nenhum superadmin ativo para receber o aviso.');
    }
    const front = (process.env.FRONTEND_URL || 'https://app.atrupe.com.br')
      .trim()
      .replace(/\/+$/, '');
    // Um número parado no homolog não pode parecer a produção fora do ar.
    const prefix = process.env.APP_ENV === 'production' ? '' : '[Homolog] ';

    for (const alert of alerts) {
      const results = await Promise.allSettled(
        people.map((person) =>
          this.mail.sendEmail(
            person.email,
            `${prefix}${alert.title}`,
            'whatsapp-alert',
            {
              name: person.name,
              title: alert.title,
              text: alert.text,
              sinceText: alert.kind === 'voltou' ? '' : brasilia(alert.since),
              tecnico: alert.kind !== 'voltou' && alert.fixBy === 'tecnico',
              panelUrl: `${front}${WHATSAPP_SCREEN}`,
            },
            [],
          ),
        ),
      );
      const failed = results.filter((item) => item.status === 'rejected');
      if (failed.length === people.length) {
        throw new Error(
          `O aviso do WhatsApp não chegou a nenhum dos ${people.length} superadmin(s).`,
        );
      }
      if (failed.length) {
        this.logger.warn(
          `Aviso do WhatsApp: ${failed.length} de ${people.length} e-mail(s) não saíram.`,
        );
      }
    }
  }

  async findPerson(userId: string): Promise<AtendimentoPerson | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        userRole: { select: { isSystemAdmin: true } },
      },
    });
    if (!user) return null;
    const superadmin =
      user.isActive && user.userRole.some((role) => role.isSystemAdmin);
    return {
      key: user.id,
      email: user.email,
      name: user.name,
      isSuperadmin: superadmin,
      isSupportStaff: superadmin,
      canConfigure: false,
    };
  }

  async addSuggestions(items: Omit<StoredSuggestion, 'id'>[]): Promise<void> {
    if (!items.length) return;
    await this.prisma.supportSuggestion.createMany({
      data: items.map((item) => ({
        tenantId: item.tenantId,
        owner: item.owner,
        conversationId: Number(item.conversationId) || 0,
        question: String(item.q ?? '').slice(0, 500),
        answer: String(item.a ?? '').slice(0, 5000),
        why: String(item.why ?? '').slice(0, 1000),
        suggestedAt: validDate(item.at),
      })),
    });
  }

  async listSuggestions(filter: {
    owner: 'plataforma' | 'cliente';
    tenantId?: string;
  }): Promise<StoredSuggestion[]> {
    const rows = await this.prisma.supportSuggestion.findMany({
      where: {
        owner: filter.owner,
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      owner: row.owner as 'plataforma' | 'cliente',
      conversationId: row.conversationId,
      q: row.question,
      a: row.answer,
      why: row.why,
      at: row.suggestedAt.toISOString(),
    }));
  }

  async takeSuggestion(id: string): Promise<boolean> {
    const { count } = await this.prisma.supportSuggestion.deleteMany({
      where: { id },
    });
    return count > 0;
  }

  async addEvent(tenantId: string, event: GapEventPayload): Promise<void> {
    await this.prisma.supportGapEvent.create({
      data: {
        tenantId,
        accountId: Number(event.account_id) || 0,
        conversationId: Number(event.conversation_id) || 0,
        category: String(event.category ?? 'outro').slice(0, 40),
        topic: String(event.topic ?? '').slice(0, 200),
        reason: String(event.reason ?? '').slice(0, 1000),
        excerpt: String(event.excerpt ?? '').slice(0, 1000),
        at: validDate(event.at),
      },
    });
  }

  async listEvents(filter: {
    tenantId?: string;
    since: string;
  }): Promise<GapEventPayload[]> {
    const rows = await this.prisma.supportGapEvent.findMany({
      where: {
        at: { gte: new Date(filter.since) },
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: { at: 'desc' },
      take: 5000,
    });
    return rows.map((row) => ({
      kind: 'handoff' as const,
      account_id: row.accountId,
      conversation_id: row.conversationId,
      category: row.category,
      topic: row.topic,
      reason: row.reason,
      excerpt: row.excerpt,
      at: row.at.toISOString(),
    }));
  }
}

function brasilia(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function validDate(value: unknown): Date {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

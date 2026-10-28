import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { aiQuotaRenewsAt, aiUsageMonth } from './ai-usage-month';
import { AiProviderUsage } from './ai.types';

/** O recurso de plano do assistente e o limite da cota do mês. */
export const AI_FEATURE = 'ai_assistant';
export const AI_QUOTA_LIMIT_KEY = 'ai_messages_month';
/** Corpo do 429 da cota: a tela reconhece pelo `code`. */
export const AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED';

export interface AiQuota {
  used: number;
  /** Nulo quando o plano não limita (sem o limite ou -1). */
  limit: number | null;
  /** Quando a cota renova: o dia 1º do mês seguinte, em São Paulo. */
  renewsAt: string;
}

type Counter =
  | 'messages'
  | 'promptTokens'
  | 'completionTokens'
  | 'costMicroUsd'
  | 'actionsProposed'
  | 'actionsApplied';

const DAY_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
});

const toCount = (value: unknown) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * O consumo do assistente por empresa e mês (tabela ai_usage) e a cota do
 * plano (limite ai_messages_month). A cota conta as mensagens do usuário que
 * chegaram ao modelo; a barrada pela proteção não conta. O limite por usuário
 * (AiChatThrottlerGuard) segura rajada; quem segura o custo do mês é a cota.
 */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /** A cota do mês, com o limite do plano (`limits` do plano da empresa). */
  async quota(
    companyId: string,
    limits: Record<string, number> | undefined,
    now = new Date(),
  ): Promise<AiQuota> {
    const month = aiUsageMonth(now);
    const row = await this.prisma.aiUsage.findUnique({
      where: { companyId_month: { companyId, month } },
      select: { messages: true },
    });
    return {
      used: row?.messages ?? 0,
      limit: this.limitOf(limits),
      renewsAt: aiQuotaRenewsAt(month).toISOString(),
    };
  }

  isExceeded(quota: AiQuota) {
    return quota.limit !== null && quota.used >= quota.limit;
  }

  /** O 429 da cota estourada, com a data de renovação. */
  quotaExceeded(quota: AiQuota) {
    const limit = quota.limit ?? quota.used;
    return new HttpException(
      {
        code: AI_QUOTA_EXCEEDED,
        quota,
        message:
          `Sua empresa usou as ${limit.toLocaleString('pt-BR')} mensagens do ` +
          `assistente deste mês. A cota renova em ` +
          `${DAY_FORMAT.format(new Date(quota.renewsAt))}.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Conta a mensagem que vai ao modelo. A soma é atômica: com duas mensagens
   * ao mesmo tempo na última vaga, a segunda é devolvida e recebe o 429.
   */
  async reserveMessage(
    companyId: string,
    limits: Record<string, number> | undefined,
    now = new Date(),
  ) {
    const month = aiUsageMonth(now);
    const limit = this.limitOf(limits);
    const row = await this.increment(companyId, month, { messages: 1 });
    if (limit !== null && row.messages > limit) {
      await this.release(companyId, month);
      throw this.quotaExceeded({
        used: limit,
        limit,
        renewsAt: aiQuotaRenewsAt(month).toISOString(),
      });
    }
  }

  /** Devolve a mensagem que não chegou a ter resposta do provedor. */
  async releaseMessage(companyId: string, now = new Date()) {
    await this.release(companyId, aiUsageMonth(now));
  }

  /** Soma os tokens e o custo de uma chamada ao provedor. */
  async recordTokens(
    companyId: string,
    usage: AiProviderUsage | undefined,
    now = new Date(),
  ) {
    if (!usage) return;
    const data = {
      promptTokens: toCount(usage.promptTokens),
      completionTokens: toCount(usage.completionTokens),
      costMicroUsd: toCount((usage.costUsd ?? 0) * 1_000_000),
    };
    if (!data.promptTokens && !data.completionTokens && !data.costMicroUsd) {
      return;
    }
    await this.increment(companyId, aiUsageMonth(now), data);
  }

  /** Proposta feita ou aplicada: a taxa de aplicação diz se elas são boas. */
  async recordAction(
    companyId: string,
    kind: 'proposed' | 'applied',
    now = new Date(),
  ) {
    await this.increment(companyId, aiUsageMonth(now), {
      [kind === 'proposed' ? 'actionsProposed' : 'actionsApplied']: 1,
    });
  }

  /** O consumo de cada empresa no mês, para o superadmin. */
  async usageByCompany(month: string) {
    const rows = await this.prisma.aiUsage.findMany({
      where: { month },
      orderBy: [{ messages: 'desc' }, { companyId: 'asc' }],
      select: {
        companyId: true,
        messages: true,
        promptTokens: true,
        completionTokens: true,
        costMicroUsd: true,
        actionsProposed: true,
        actionsApplied: true,
        company: { select: { name: true } },
      },
    });
    const companies = rows.map(({ company, ...row }) => ({
      ...row,
      companyName: company?.name ?? null,
      costUsd: row.costMicroUsd / 1_000_000,
      applyRate: row.actionsProposed
        ? Math.round((row.actionsApplied / row.actionsProposed) * 10_000) /
          10_000
        : null,
    }));
    const sum = (field: Counter) =>
      rows.reduce((total, row) => total + row[field], 0);
    return {
      month,
      companies,
      totals: {
        companies: rows.length,
        messages: sum('messages'),
        promptTokens: sum('promptTokens'),
        completionTokens: sum('completionTokens'),
        costMicroUsd: sum('costMicroUsd'),
        costUsd: sum('costMicroUsd') / 1_000_000,
        actionsProposed: sum('actionsProposed'),
        actionsApplied: sum('actionsApplied'),
      },
    };
  }

  private limitOf(limits: Record<string, number> | undefined) {
    const value = limits?.[AI_QUOTA_LIMIT_KEY];
    return value === undefined || value === null || value === -1 ? null : value;
  }

  private async release(companyId: string, month: string) {
    await this.prisma.aiUsage.updateMany({
      where: { companyId, month, messages: { gt: 0 } },
      data: { messages: { decrement: 1 } },
    });
  }

  private async increment(
    companyId: string,
    month: string,
    data: Partial<Record<Counter, number>>,
  ) {
    const update = Object.fromEntries(
      Object.entries(data).map(([field, value]) => [
        field,
        { increment: value },
      ]),
    );
    try {
      return await this.prisma.aiUsage.upsert({
        where: { companyId_month: { companyId, month } },
        create: { companyId, month, ...data },
        update,
      });
    } catch (error) {
      // As duas primeiras chamadas do mês ao mesmo tempo: o create da segunda
      // bate na chave única, mas a linha já existe e a soma vale
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      return this.prisma.aiUsage.update({
        where: { companyId_month: { companyId, month } },
        data: update,
      });
    }
  }
}

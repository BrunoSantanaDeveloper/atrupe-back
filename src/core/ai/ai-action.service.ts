import {
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { PlanControlService } from '../plan/plan-control.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import {
  AiQuotationDraftService,
  QuotationDraftEdits,
  QuotationDraftPayload,
} from './ai-quotation-draft.service';
import { AI_PLAN_DENIED_REASON, enabledFeatures } from './ai-plan';
import {
  AiProposalsService,
  FinancialCategoryPayload,
  ItemDescriptionPayload,
  NextContactPayload,
} from './ai-proposals.service';
import { AI_FEATURE, AiUsageService } from './ai-usage.service';
import { AiRequestUser } from './ai.types';

export type AiActionType =
  | 'QUOTATION_DRAFT'
  | 'QUICK_SALE_DRAFT'
  | 'ITEM_DESCRIPTION'
  | 'FINANCIAL_CATEGORY'
  | 'NEXT_CONTACT';

/** O que a resposta do chat traz de cada proposta. */
export interface AiActionSummary {
  id: string;
  type: AiActionType;
  summary: string;
}

/** A proposta vence em 24 horas. */
export const AI_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

/** O recurso de plano de cada tipo, além do ai_assistant. */
const TYPE_FEATURES: Partial<Record<AiActionType, string[]>> = {
  QUICK_SALE_DRAFT: ['quotation_quick_sale'],
  NEXT_CONTACT: ['quotation_status_column'],
};

const NOT_FOUND = 'Proposta não encontrada.';

/**
 * As propostas do assistente (seção 4 do documento de 28/10/2026): a IA
 * propõe e a pessoa confirma. Só quem recebeu a proposta a vê e aplica; ela
 * vence em 24 horas; aplicar duas vezes devolve o resultado da primeira. Ao
 * aplicar, o servidor confere de novo a permissão, o plano e o bloqueio da
 * empresa (rota) e recalcula tudo antes de gravar pelos serviços das telas.
 */
@Injectable()
export class AiActionService {
  private readonly logger = new Logger(AiActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly planControl: PlanControlService,
    private readonly settings: SystemSettingsService,
    private readonly usage: AiUsageService,
    private readonly drafts: AiQuotationDraftService,
    private readonly proposals: AiProposalsService,
  ) {}

  async propose(
    user: AiRequestUser,
    type: AiActionType,
    payload: unknown,
    conversationId?: string,
  ): Promise<AiActionSummary> {
    const action = await this.prisma.aiAction.create({
      data: {
        companyId: user.companyId,
        userId: user.userId,
        conversationId: conversationId ?? null,
        type,
        payload: payload as object,
        expiresAt: new Date(Date.now() + AI_ACTION_TTL_MS),
      },
      select: { id: true },
    });
    await this.usage.recordAction(user.companyId, 'proposed');
    return { id: action.id, type, summary: this.summaryOf(type, payload) };
  }

  /** As propostas ficam ligadas à resposta do assistente que as trouxe. */
  async attachMessage(ids: string[], messageId: string) {
    if (!ids.length) return;
    await this.prisma.aiAction.updateMany({
      where: { id: { in: ids } },
      data: { messageId },
    });
  }

  /** A proposta completa, para o cartão. */
  async get(id: string, user: AiRequestUser) {
    const action = await this.ownAction(id, user);
    const status = await this.currentStatus(action);
    return this.view({ ...action, status }, user);
  }

  async apply(id: string, user: AiRequestUser, edited?: unknown) {
    const action = await this.ownAction(id, user);
    if (action.status === 'APPLIED') return action.result;
    if (action.status === 'DISCARDED') {
      throw new GoneException('A proposta foi descartada.');
    }
    if ((await this.currentStatus(action)) === 'EXPIRED') {
      throw new GoneException(
        'A proposta venceu (vale por 24 horas). Peça de novo ao assistente.',
      );
    }
    const features = await this.ensureAccess(user, action.type as AiActionType);

    // Só uma aplicação por vez: quem chega depois recebe o resultado da
    // primeira ou o aviso de que ela está em andamento
    const claimed = await this.prisma.aiAction.updateMany({
      where: { id: action.id, status: 'PROPOSED' },
      data: { status: 'APPLYING', edited: (edited ?? undefined) as object },
    });
    if (!claimed.count) {
      const now = await this.ownAction(id, user);
      if (now.status === 'APPLIED') return now.result;
      throw new ConflictException('A proposta já está sendo aplicada.');
    }

    try {
      const result = await this.applyByType(
        action.type as AiActionType,
        action.payload,
        edited,
        user,
        features,
      );
      await this.prisma.aiAction.update({
        where: { id: action.id },
        data: {
          status: 'APPLIED',
          result: result as object,
          appliedAt: new Date(),
        },
      });
      await this.usage.recordAction(user.companyId, 'applied');
      return result;
    } catch (error) {
      // A recusa da regra (falta escolher, sem permissão) volta a proposta
      // para a pessoa corrigir; a falha inesperada fica registrada
      const expected =
        error instanceof HttpException && error.getStatus() < 500;
      await this.prisma.aiAction.update({
        where: { id: action.id },
        data: {
          status: expected ? 'PROPOSED' : 'FAILED',
          result: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
      if (!expected) {
        this.logger.error(
          `Falha ao aplicar a proposta ${action.id}: ${(error as Error)?.message}`,
        );
      }
      throw error;
    }
  }

  async discard(id: string, user: AiRequestUser) {
    const action = await this.ownAction(id, user);
    if (action.status === 'APPLIED') {
      throw new ConflictException('A proposta já foi aplicada.');
    }
    if (action.status === 'APPLYING') {
      throw new ConflictException('A proposta está sendo aplicada.');
    }
    if (action.status !== 'DISCARDED') {
      await this.prisma.aiAction.updateMany({
        where: {
          id: action.id,
          status: { in: ['PROPOSED', 'EXPIRED', 'FAILED'] },
        },
        data: { status: 'DISCARDED' },
      });
    }
    return { id: action.id, status: 'DISCARDED' };
  }

  private async applyByType(
    type: AiActionType,
    payload: unknown,
    edited: unknown,
    user: AiRequestUser,
    features: ReadonlySet<string>,
  ) {
    switch (type) {
      case 'QUOTATION_DRAFT':
      case 'QUICK_SALE_DRAFT':
        return this.drafts.apply(
          payload as QuotationDraftPayload,
          (edited ?? undefined) as QuotationDraftEdits | undefined,
          user,
          features,
        );
      case 'ITEM_DESCRIPTION':
        return this.proposals.applyItemDescription(
          payload as ItemDescriptionPayload,
          edited as { text?: unknown } | undefined,
          user,
        );
      case 'FINANCIAL_CATEGORY':
        return this.proposals.applyFinancialCategory(
          payload as FinancialCategoryPayload,
          edited as Record<string, unknown> | undefined,
          user,
        );
      case 'NEXT_CONTACT':
        return this.proposals.applyNextContact(
          payload as NextContactPayload,
          edited as Record<string, unknown> | undefined,
          user,
        );
      default:
        throw new ConflictException('Tipo de proposta sem aplicação.');
    }
  }

  /** A chave global, o assistente no plano e o recurso do tipo. */
  private async ensureAccess(user: AiRequestUser, type: AiActionType) {
    if (!(await this.settings.isAiAccessEnabled())) {
      throw new ServiceUnavailableException(
        'O Assistente IA esta temporariamente indisponivel.',
      );
    }
    const plan = await this.planControl.getCompanyPlanInfo(user.companyId);
    const features = enabledFeatures(plan?.features);
    const required = [AI_FEATURE, ...(TYPE_FEATURES[type] ?? [])];
    const missing = required.find((key) => !features.has(key));
    if (missing) {
      await this.planControl.enforceFeature(user.companyId, missing);
      throw new NotFoundException(AI_PLAN_DENIED_REASON);
    }
    return features;
  }

  /** De outra pessoa ou de outra empresa, a proposta "não existe". */
  private async ownAction(id: string, user: AiRequestUser) {
    const action = isUUID(id)
      ? await this.prisma.aiAction.findFirst({
          where: { id, companyId: user.companyId, userId: user.userId },
        })
      : null;
    if (!action) throw new NotFoundException(NOT_FOUND);
    return action;
  }

  /** Vencida e ainda em aberto: marca EXPIRED na leitura. */
  private async currentStatus(action: {
    id: string;
    status: string;
    expiresAt: Date;
  }) {
    if (action.status === 'PROPOSED' && action.expiresAt <= new Date()) {
      await this.prisma.aiAction.updateMany({
        where: { id: action.id, status: 'PROPOSED' },
        data: { status: 'EXPIRED' },
      });
      return 'EXPIRED';
    }
    return action.status;
  }

  /** Sem values:values, a proposta sai sem preços. */
  private async view(
    action: {
      id: string;
      type: string;
      status: string;
      payload: unknown;
      result: unknown;
      expiresAt: Date;
      appliedAt: Date | null;
      createdAt: Date;
    },
    user: AiRequestUser,
  ) {
    const canSeeValues = await this.abacService.hasPermission(
      user,
      'view',
      'values:values',
    );
    const isDraft =
      action.type === 'QUOTATION_DRAFT' || action.type === 'QUICK_SALE_DRAFT';
    return {
      id: action.id,
      type: action.type,
      status: action.status,
      payload:
        isDraft && !canSeeValues
          ? this.drafts.withoutValues(action.payload as QuotationDraftPayload)
          : action.payload,
      result: action.result ?? null,
      expiresAt: action.expiresAt,
      appliedAt: action.appliedAt,
      createdAt: action.createdAt,
    };
  }

  private summaryOf(type: AiActionType, payload: unknown) {
    switch (type) {
      case 'QUOTATION_DRAFT':
      case 'QUICK_SALE_DRAFT':
        return this.drafts.summaryLine(payload as QuotationDraftPayload);
      default:
        return this.proposals.summaryLine(type, payload);
    }
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import { AiQuotationDraftRequestDto } from './dto/ai-action.dto';
import { AiActionService, AiActionSummary } from './ai-action.service';
import { AiSafetyService } from './ai-safety.service';
import {
  AiPlanFeatures,
  AiToolRegistry,
  enabledFeatures,
} from './ai-tool-registry.service';
import { AI_FEATURE, AiQuota, AiUsageService } from './ai-usage.service';
import {
  AiMessage,
  AiProviderResponse,
  AiRequestUser,
  AiToolDefinition,
  AiToolExecutionResult,
} from './ai.types';
import { AI_PROVIDER, AiProvider } from './providers/ai-provider.interface';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { PlanControlService } from '../plan/plan-control.service';

const DRAFT_TOOL = 'propose_quotation_draft';

/** Por que o assistente está desligado para a empresa (access-status). */
export type AiAccessReason = 'SYSTEM_OFF' | 'NOT_IN_PLAN' | 'QUOTA_EXCEEDED';

/** O plano da empresa, lido uma vez por requisição. */
interface AiAccess {
  features: AiPlanFeatures;
  limits: Record<string, number>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly safety: AiSafetyService,
    private readonly tools: AiToolRegistry,
    private readonly settings: SystemSettingsService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly planControl: PlanControlService,
    private readonly usage: AiUsageService,
    private readonly actions: AiActionService,
  ) {}

  /**
   * Para o widget: ligado é a chave global e o plano, com cota no mês. Cota
   * estourada desliga o envio (QUOTA_EXCEEDED), mas as conversas continuam
   * abertas para leitura.
   */
  async accessStatus(user: AiRequestUser): Promise<{
    enabled: boolean;
    reason?: AiAccessReason;
    quota: AiQuota | null;
  }> {
    const systemEnabled = await this.settings.isAiAccessEnabled();
    const plan = user.companyId
      ? await this.planControl.getCompanyPlanInfo(user.companyId)
      : null;
    const quota = user.companyId
      ? await this.usage.quota(user.companyId, plan?.limits)
      : null;
    const reason: AiAccessReason | undefined = !systemEnabled
      ? 'SYSTEM_OFF'
      : !plan?.features?.[AI_FEATURE]
        ? 'NOT_IN_PLAN'
        : quota && this.usage.isExceeded(quota)
          ? 'QUOTA_EXCEEDED'
          : undefined;
    return { enabled: !reason, ...(reason ? { reason } : {}), quota };
  }

  async chat(dto: AiChatRequestDto, user: AiRequestUser) {
    const access = await this.ensureAccess(user);

    // Cota estourada: nem grava a mensagem, nem chama o provedor
    const quota = await this.usage.quota(user.companyId, access.limits);
    if (this.usage.isExceeded(quota)) throw this.usage.quotaExceeded(quota);

    const conversation = await this.getOrCreateConversation(dto, user);
    const safetyResult = this.safety.inspectUserMessage(dto.message);

    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: dto.message,
        metadata: {
          context: dto.context || {},
          safety: safetyResult,
        } as any,
      },
    });

    // A mensagem barrada pela proteção não vai ao modelo e não conta na cota
    if (safetyResult.blocked) {
      const blockedMessage =
        safetyResult.reason ||
        'Posso ajudar com dúvidas sobre operação, relatórios e uso do Atrupe.';

      await this.prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content: blockedMessage,
          metadata: {
            safety: safetyResult,
            blocked: true,
            provider: null,
            model: null,
          } as any,
        },
      });

      return {
        conversationId: conversation.id,
        message: blockedMessage,
        sources: [],
        toolCalls: [],
        actions: [],
      };
    }

    await this.usage.reserveMessage(user.companyId, access.limits);

    const historyLimit = this.config.get<number>('ai.maxHistoryMessages') || 20;
    const maxToolCalls = this.config.get<number>('ai.maxToolCalls') || 5;

    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: historyLimit,
    });

    const messages: AiMessage[] = [
      {
        role: 'system',
        content: this.safety.buildSystemPrompt(dto.context?.currentPath),
      },
      ...history
        .reverse()
        .filter((message) => ['user', 'assistant'].includes(message.role))
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
        })),
    ];

    const tools = this.tools.getDefinitions(access.features);
    const executedTools: AiToolExecutionResult[] = [];
    const suspiciousToolCalls: string[] = [];
    let response: AiProviderResponse;
    try {
      response = await this.complete(conversation.id, messages, tools, user);
    } catch (error) {
      // Sem resposta do provedor, a mensagem não conta
      await this.usage.releaseMessage(user.companyId);
      throw error;
    }

    for (let i = 0; response.toolCalls.length && i < maxToolCalls; i++) {
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        const result = await this.tools.execute(
          toolCall.function.name,
          this.parseToolArguments(toolCall.function.arguments),
          user,
          access.features,
          {
            conversationId: conversation.id,
            currentPath: dto.context?.currentPath,
          },
        );
        executedTools.push(result);
        if (result.status === 'denied' || result.status === 'error') {
          suspiciousToolCalls.push(toolCall.function.name);
        }
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.content),
        });
      }

      response = await this.complete(conversation.id, messages, tools, user);
    }

    const finalMessage =
      response.content ||
      'Não consegui concluir a resposta com segurança. Tente reformular a pergunta.';

    const actions = this.actionsOf(executedTools);
    const assistantMessage = await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: finalMessage,
        toolCalls: executedTools.map((tool) => ({
          name: tool.name,
          status: tool.status,
          ...(tool.action ? { actionId: tool.action.id } : {}),
        })) as any,
        metadata: {
          provider: this.config.get<string>('ai.provider'),
          model: response.model || this.config.get<string>('ai.model'),
          modelAttempts: response.modelAttempts || [],
          safety: {
            input: safetyResult,
            suspiciousToolCalls,
          },
        } as any,
      },
    });

    await this.actions.attachMessage(
      actions.map((action) => action.id),
      assistantMessage.id,
    );

    return {
      conversationId: conversation.id,
      message: finalMessage,
      sources: this.extractSources(executedTools),
      toolCalls: executedTools.map((tool) => ({
        name: tool.name,
        status: tool.status,
      })),
      actions,
    };
  }

  /**
   * O atalho "Montar com IA" do orçamento (sem chat): o vendedor cola o
   * texto do cliente e recebe a proposta. Conta uma mensagem na cota.
   */
  async quotationDraft(dto: AiQuotationDraftRequestDto, user: AiRequestUser) {
    const access = await this.ensureAccess(user);
    const quota = await this.usage.quota(user.companyId, access.limits);
    if (this.usage.isExceeded(quota)) throw this.usage.quotaExceeded(quota);

    const safetyResult = this.safety.inspectDraftText(dto.text);
    if (safetyResult.blocked)
      throw new BadRequestException(safetyResult.reason);

    await this.usage.reserveMessage(user.companyId, access.limits);
    const tool = this.tools
      .getDefinitions(access.features)
      .find((definition) => definition.function.name === DRAFT_TOOL);
    let response: AiProviderResponse;
    try {
      response = await this.provider.complete({
        conversationId: `quotation-draft:${randomUUID()}`,
        messages: [
          { role: 'system', content: this.safety.buildDraftPrompt() },
          { role: 'user', content: dto.text },
        ],
        tools: tool ? [tool] : [],
        toolChoice: { type: 'function', function: { name: DRAFT_TOOL } },
      });
    } catch (error) {
      await this.usage.releaseMessage(user.companyId);
      throw error;
    }
    await this.usage.recordTokens(user.companyId, response.usage);

    const call = response.toolCalls.find(
      (toolCall) => toolCall.function.name === DRAFT_TOOL,
    );
    if (!call) {
      throw new UnprocessableEntityException(
        'Não encontrei produtos e quantidades no texto. Confira o pedido e tente de novo.',
      );
    }
    const result = await this.tools.execute(
      DRAFT_TOOL,
      this.parseToolArguments(call.function.arguments),
      user,
      access.features,
      { quotationId: dto.quotationId },
    );
    if (!result.action) {
      const content = result.content as { reason?: string; message?: string };
      if (result.status === 'denied') {
        throw new ForbiddenException(content?.reason);
      }
      // O erro interno fica no log; a tela recebe o aviso
      this.logger.error(`Montar com IA falhou: ${content?.message}`);
      throw new UnprocessableEntityException(
        'Não consegui montar a proposta. Tente de novo em instantes.',
      );
    }
    return this.actions.get(result.action.id, user);
  }

  getAction(id: string, user: AiRequestUser) {
    return this.actions.get(id, user);
  }

  async applyAction(id: string, user: AiRequestUser, edited?: unknown) {
    return this.actions.apply(id, user, edited);
  }

  discardAction(id: string, user: AiRequestUser) {
    return this.actions.discard(id, user);
  }

  private actionsOf(tools: AiToolExecutionResult[]): AiActionSummary[] {
    return tools
      .map((tool) => tool.action)
      .filter((action): action is AiActionSummary => !!action);
  }

  /** O consumo de cada empresa no mês (superadmin). */
  usageByCompany(month: string) {
    return this.usage.usageByCompany(month);
  }

  async listConversations(user: AiRequestUser) {
    await this.ensureAccess(user);

    return this.prisma.aiConversation.findMany({
      where: {
        companyId: user.companyId,
        userId: user.userId,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listMessages(conversationId: string, user: AiRequestUser) {
    await this.ensureAccess(user);

    await this.ensureConversationAccess(conversationId, user);
    return this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        toolCalls: true,
        metadata: true,
        createdAt: true,
      },
    });
  }

  async deleteConversation(conversationId: string, user: AiRequestUser) {
    await this.ensureAccess(user);

    await this.ensureConversationAccess(conversationId, user);
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  /** Cada chamada ao provedor soma os tokens e o custo do mês. */
  private async complete(
    conversationId: string,
    messages: AiMessage[],
    tools: AiToolDefinition[],
    user: AiRequestUser,
  ) {
    const response = await this.provider.complete({
      conversationId,
      messages,
      tools,
    });
    await this.usage.recordTokens(user.companyId, response.usage);
    return response;
  }

  private async getOrCreateConversation(
    dto: AiChatRequestDto,
    user: AiRequestUser,
  ) {
    if (dto.conversationId) {
      await this.ensureConversationAccess(dto.conversationId, user);
      return this.prisma.aiConversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      });
    }

    return this.prisma.aiConversation.create({
      data: {
        companyId: user.companyId,
        userId: user.userId,
        title: this.makeTitle(dto.message),
      },
    });
  }

  private async ensureConversationAccess(
    conversationId: string,
    user: AiRequestUser,
  ) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: {
        id: conversationId,
        companyId: user.companyId,
        userId: user.userId,
        deletedAt: null,
      },
    });

    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
  }

  private parseToolArguments(raw: string) {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private makeTitle(message: string) {
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 70 ? `${compact.slice(0, 67)}...` : compact;
  }

  private extractSources(tools: AiToolExecutionResult[]) {
    return Array.from(
      new Set(
        tools
          .filter((tool) => tool.status === 'success')
          .map((tool) => tool.name),
      ),
    );
  }

  /**
   * A chave global (interruptor de emergência: desligada, ninguém usa) e o
   * plano da empresa (ai_assistant). Devolve o plano para a mensagem não
   * ler de novo.
   */
  private async ensureAccess(user: AiRequestUser): Promise<AiAccess> {
    const enabled = await this.settings.isAiAccessEnabled();
    if (!enabled) {
      throw new ServiceUnavailableException(
        'O Assistente IA esta temporariamente indisponivel.',
      );
    }

    if (!user.companyId) {
      throw new ForbiddenException('Usuário sem empresa ativa.');
    }

    const plan = await this.planControl.getCompanyPlanInfo(user.companyId);
    if (!plan?.features?.[AI_FEATURE]) {
      // O 403 do sistema: diz de qual plano em diante o recurso existe
      await this.planControl.enforceFeature(user.companyId, AI_FEATURE);
    }

    return {
      features: enabledFeatures(plan?.features),
      limits: plan?.limits ?? {},
    };
  }
}

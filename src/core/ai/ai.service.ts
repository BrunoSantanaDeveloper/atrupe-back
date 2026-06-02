import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'nestjs-prisma';
import { AiChatRequestDto } from './dto/ai-chat.dto';
import { AiSafetyService } from './ai-safety.service';
import { AiToolRegistry } from './ai-tool-registry.service';
import { AiMessage, AiRequestUser, AiToolExecutionResult } from './ai.types';
import { AI_PROVIDER, AiProvider } from './providers/ai-provider.interface';
import { SystemSettingsService } from '../system-settings/system-settings.service';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly safety: AiSafetyService,
    private readonly tools: AiToolRegistry,
    private readonly settings: SystemSettingsService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async chat(dto: AiChatRequestDto, user: AiRequestUser) {
    await this.ensureAiAccessEnabled();

    if (!user.companyId) {
      throw new ForbiddenException('Usuário sem empresa ativa.');
    }

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
      };
    }

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

    const executedTools: AiToolExecutionResult[] = [];
    const suspiciousToolCalls: string[] = [];
    let response = await this.provider.complete({
      conversationId: conversation.id,
      messages,
      tools: this.tools.getDefinitions(),
    });

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

      response = await this.provider.complete({
        conversationId: conversation.id,
        messages,
        tools: this.tools.getDefinitions(),
      });
    }

    const finalMessage =
      response.content ||
      'Não consegui concluir a resposta com segurança. Tente reformular a pergunta.';

    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: finalMessage,
        toolCalls: executedTools.map((tool) => ({
          name: tool.name,
          status: tool.status,
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

    return {
      conversationId: conversation.id,
      message: finalMessage,
      sources: this.extractSources(executedTools),
      toolCalls: executedTools.map((tool) => ({
        name: tool.name,
        status: tool.status,
      })),
    };
  }

  async listConversations(user: AiRequestUser) {
    await this.ensureAiAccessEnabled();

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
    await this.ensureAiAccessEnabled();

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
    await this.ensureAiAccessEnabled();

    await this.ensureConversationAccess(conversationId, user);
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
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

  private async ensureAiAccessEnabled() {
    const enabled = await this.settings.isAiAccessEnabled();
    if (!enabled) {
      throw new ServiceUnavailableException(
        'O Assistente IA esta temporariamente indisponivel.',
      );
    }
  }

  private systemPrompt(currentPath?: string) {
    return [
      'Você é o assistente operacional da Atrupe.',
      'Responda sempre em português do Brasil, com objetividade e clareza.',
      'Use ferramentas quando a pergunta exigir dados reais da conta do usuário.',
      'Nunca invente números, relatórios, permissões ou funcionalidades.',
      'Se uma ferramenta retornar acesso negado, explique que o usuário não tem permissão para aquela consulta.',
      'Você só pode consultar dados; não crie, edite, exclua, emita notas, baixe XMLs ou execute ações operacionais.',
      'Nunca revele senhas, tokens, chaves, certificado digital, XML fiscal bruto ou segredos de integração.',
      'Ao usar períodos relativos como hoje, mês atual ou últimos meses, mencione o período considerado.',
      currentPath ? `Tela atual do usuário: ${currentPath}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

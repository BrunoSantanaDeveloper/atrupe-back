import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiModelSelectionService } from '../ai-model-selection.service';
import { AiMessage, AiProviderResponse, AiToolDefinition } from '../ai.types';
import { AiProvider } from './ai-provider.interface';
import { openRouterProviderPreferences } from './openrouter-data-policy';

interface OpenRouterChoice {
  message?: {
    content?: string | null;
    tool_calls?: AiProviderResponse['toolCalls'];
  };
}

interface ModelAttempt {
  model: string;
  status: 'success' | 'error';
  reason?: string;
  statusCode?: number;
}

@Injectable()
export class OpenRouterAiProvider implements AiProvider {
  private readonly logger = new Logger(OpenRouterAiProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly modelSelection: AiModelSelectionService,
  ) {}

  async complete(params: {
    conversationId: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiProviderResponse> {
    const apiKey = this.config.get<string>('ai.apiKey');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Assistente de IA indisponível. Configure AI_API_KEY no backend.',
      );
    }

    const baseUrl = this.config.get<string>('ai.baseUrl');
    const models = await this.getModelChain();
    const attempts: ModelAttempt[] = [];

    for (let index = 0; index < models.length; index++) {
      const model = models[index];

      try {
        const response = await axios.post(
          `${baseUrl}/chat/completions`,
          {
            model,
            messages: params.messages,
            tools: params.tools,
            tool_choice: 'auto',
            stream: false,
            session_id: params.conversationId,
            provider: openRouterProviderPreferences(this.config),
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        );

        const choice = (response.data?.choices?.[0] || {}) as OpenRouterChoice;
        const message = choice.message;

        if (!message) {
          throw new Error('Resposta inválida do provedor de IA.');
        }

        attempts.push({ model, status: 'success' });
        await this.modelSelection.recordModelSuccess(model);

        return {
          content: message.content || '',
          toolCalls: message.tool_calls || [],
          model,
          modelAttempts: attempts,
        };
      } catch (error) {
        const failure = this.describeFailure(error);
        attempts.push({
          model,
          status: 'error',
          reason: failure.reason,
          statusCode: failure.statusCode,
        });

        if (failure.retryable) {
          await this.modelSelection.recordModelFailure(
            model,
            failure.reason,
            failure.statusCode,
          );
        }

        const hasNextModel = index < models.length - 1;
        if (!failure.retryable || !hasNextModel) {
          this.logger.error(
            `Assistente de IA sem resposta. Modelo ${model}${
              failure.statusCode ? ` (HTTP ${failure.statusCode})` : ''
            }: ${failure.reason}`,
          );
          throw new ServiceUnavailableException(
            'Assistente de IA indisponível no momento. Tente novamente em instantes.',
          );
        }

        this.logger.warn(
          `Falha no modelo ${model}; tentando fallback ${models[index + 1]}: ${failure.reason}`,
        );
      }
    }

    throw new ServiceUnavailableException(
      'Assistente de IA indisponível no momento. Tente novamente em instantes.',
    );
  }

  private async getModelChain() {
    const activeModel = await this.modelSelection.getActiveModel();
    const fallbackModels = this.config.get<string[]>('ai.fallbackModels') || [];
    const maxRetries = this.config.get<number>('ai.modelMaxRetries') || 0;

    return Array.from(
      new Set([activeModel, ...fallbackModels].filter(Boolean)),
    ).slice(0, maxRetries + 1);
  }

  private describeFailure(error: any): {
    retryable: boolean;
    reason: string;
    statusCode?: number;
  } {
    const statusCode = error?.response?.status;
    const providerMessage = this.extractProviderMessage(error);
    const reason = providerMessage || error?.message || 'Falha desconhecida.';

    if (!statusCode) {
      return {
        retryable: true,
        reason,
      };
    }

    // 404 é do modelo, não da chamada: não existe, está sem provedor ou
    // nenhum provedor dele atende à política de dados. O próximo pode ter
    if ([404, 408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
      return {
        retryable: true,
        reason,
        statusCode,
      };
    }

    if (
      [400, 422].includes(statusCode) &&
      /(tool|tools|tool_choice|function|functions)/i.test(reason)
    ) {
      return {
        retryable: true,
        reason,
        statusCode,
      };
    }

    return {
      retryable: false,
      reason,
      statusCode,
    };
  }

  private extractProviderMessage(error: any) {
    const data = error?.response?.data;
    if (!data) return undefined;
    if (typeof data === 'string') return data;
    return data.error?.message || data.message || data.error;
  }
}

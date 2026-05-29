import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiMessage, AiProviderResponse, AiToolDefinition } from '../ai.types';
import { AiProvider } from './ai-provider.interface';

interface OpenRouterChoice {
  message?: {
    content?: string | null;
    tool_calls?: AiProviderResponse['toolCalls'];
  };
}

@Injectable()
export class OpenRouterAiProvider implements AiProvider {
  constructor(private readonly config: ConfigService) {}

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
    const model = this.config.get<string>('ai.model');

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: 'auto',
        stream: false,
        session_id: params.conversationId,
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
    const message = choice.message || {};

    return {
      content: message.content || '',
      toolCalls: message.tool_calls || [],
    };
  }
}

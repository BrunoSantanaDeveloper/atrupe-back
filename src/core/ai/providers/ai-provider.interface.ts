import { AiMessage, AiProviderResponse, AiToolDefinition } from '../ai.types';

export interface AiProvider {
  complete(params: {
    conversationId: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
  }): Promise<AiProviderResponse>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

import { AiMessage, AiProviderResponse, AiToolDefinition } from '../ai.types';

/** "auto" ou a ferramenta que o modelo tem de chamar. */
export type AiToolChoice =
  | 'auto'
  | { type: 'function'; function: { name: string } };

export interface AiProvider {
  complete(params: {
    conversationId: string;
    messages: AiMessage[];
    tools: AiToolDefinition[];
    toolChoice?: AiToolChoice;
  }): Promise<AiProviderResponse>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export type AiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: AiToolCall[];
}

export interface AiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiProviderResponse {
  content: string;
  toolCalls: AiToolCall[];
}

export interface AiToolExecutionResult {
  name: string;
  status: 'success' | 'denied' | 'error';
  content: unknown;
}

export interface AiRequestUser {
  userId: string;
  username?: string;
  companyId: string;
  role?: string;
  isAdmin?: boolean;
  isSystemAdmin?: boolean;
  employeeId?: string;
}

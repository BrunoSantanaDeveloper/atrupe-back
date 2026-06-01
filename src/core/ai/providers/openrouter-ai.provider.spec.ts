import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { OpenRouterAiProvider } from './openrouter-ai.provider';

jest.mock('axios');

describe('OpenRouterAiProvider', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
      get: jest.fn((key: string) => {
        const values = {
          'ai.apiKey': 'secret',
          'ai.baseUrl': 'https://openrouter.ai/api/v1',
          'ai.model': 'openai/gpt-4o-mini',
          'ai.fallbackModels': ['google/gemini-3.1-flash-lite'],
          'ai.modelMaxRetries': 2,
          ...overrides,
        };
        return values[key];
      }),
    } as unknown as ConfigService;
  }

  function makeModelSelection(activeModel = 'openai/gpt-oss-120b') {
    return {
      getActiveModel: jest.fn().mockResolvedValue(activeModel),
      recordModelFailure: jest.fn().mockResolvedValue(undefined),
      recordModelSuccess: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('monta payload compatível com Chat Completions', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: 'Resposta final',
              tool_calls: [],
            },
          },
        ],
      },
    });

    const config = makeConfig();
    const modelSelection = makeModelSelection();

    const provider = new OpenRouterAiProvider(config, modelSelection as any);
    const result = await provider.complete({
      conversationId: 'conversation-1',
      messages: [{ role: 'user', content: 'Oi' }],
      tools: [],
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Oi' }],
        tools: [],
        tool_choice: 'auto',
        stream: false,
        session_id: 'conversation-1',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
      }),
    );
    expect(result.content).toBe('Resposta final');
    expect(result.model).toBe('openai/gpt-oss-120b');
    expect(result.modelAttempts).toEqual([
      { model: 'openai/gpt-oss-120b', status: 'success' },
    ]);
    expect(modelSelection.recordModelSuccess).toHaveBeenCalledWith(
      'openai/gpt-oss-120b',
    );
  });

  it('tenta modelo fallback quando o modelo ativo falha com erro transitório', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({
        response: {
          status: 429,
          data: {
            error: {
              message: 'rate limit',
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'Resposta fallback',
                tool_calls: [],
              },
            },
          ],
        },
      });

    const config = makeConfig();
    const modelSelection = makeModelSelection();
    const provider = new OpenRouterAiProvider(config, modelSelection as any);

    const result = await provider.complete({
      conversationId: 'conversation-1',
      messages: [{ role: 'user', content: 'Oi' }],
      tools: [],
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post).toHaveBeenNthCalledWith(
      2,
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        model: 'google/gemini-3.1-flash-lite',
      }),
      expect.any(Object),
    );
    expect(result.content).toBe('Resposta fallback');
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect(result.modelAttempts).toEqual([
      {
        model: 'openai/gpt-oss-120b',
        status: 'error',
        reason: 'rate limit',
        statusCode: 429,
      },
      { model: 'google/gemini-3.1-flash-lite', status: 'success' },
    ]);
    expect(modelSelection.recordModelFailure).toHaveBeenCalledWith(
      'openai/gpt-oss-120b',
      'rate limit',
      429,
    );
  });
});

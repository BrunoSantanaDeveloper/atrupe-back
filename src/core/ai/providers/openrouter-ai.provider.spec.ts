import axios from 'axios';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
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

  describe('política de dados', () => {
    const answer = (content: string) => ({
      data: { choices: [{ message: { content, tool_calls: [] } }] },
    });
    const noEndpoint = {
      response: {
        status: 404,
        data: {
          error: { message: 'No endpoints found matching your data policy.' },
        },
      },
    };
    const complete = (provider: OpenRouterAiProvider) =>
      provider.complete({
        conversationId: 'conversation-1',
        messages: [{ role: 'user', content: 'Oi' }],
        tools: [],
      });

    it('pede ao provedor que não treine com as conversas nem as guarde', async () => {
      mockedAxios.post.mockResolvedValueOnce(answer('Resposta final'));

      await complete(
        new OpenRouterAiProvider(makeConfig(), makeModelSelection() as any),
      );

      expect((mockedAxios.post.mock.calls[0][1] as any).provider).toEqual({
        data_collection: 'deny',
        zdr: true,
      });
    });

    it('com a retenção zero desligada, continua recusando provedor que treina', async () => {
      mockedAxios.post.mockResolvedValueOnce(answer('Resposta final'));

      await complete(
        new OpenRouterAiProvider(
          makeConfig({ 'ai.zeroDataRetention': false }),
          makeModelSelection() as any,
        ),
      );

      expect((mockedAxios.post.mock.calls[0][1] as any).provider).toEqual({
        data_collection: 'deny',
      });
    });

    it('modelo sem provedor que atenda à política passa ao próximo da cadeia', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(noEndpoint)
        .mockResolvedValueOnce(answer('Resposta fallback'));
      const modelSelection = makeModelSelection();

      const result = await complete(
        new OpenRouterAiProvider(makeConfig(), modelSelection as any),
      );

      expect(result.model).toBe('google/gemini-3.1-flash-lite');
      expect(modelSelection.recordModelFailure).toHaveBeenCalledWith(
        'openai/gpt-oss-120b',
        'No endpoints found matching your data policy.',
        404,
      );
    });

    it('sem outro modelo na cadeia, o motivo vai para o log e o assistente fica indisponível', async () => {
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mockedAxios.post.mockRejectedValueOnce(noEndpoint);
      const modelSelection = makeModelSelection();

      await expect(
        complete(
          new OpenRouterAiProvider(
            makeConfig({ 'ai.modelMaxRetries': 0 }),
            modelSelection as any,
          ),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        'Assistente de IA sem resposta. Modelo openai/gpt-oss-120b (HTTP 404): No endpoints found matching your data policy.',
      );
      // Fica também na configuração do modelo, que o superadmin consulta
      expect(modelSelection.recordModelFailure).toHaveBeenCalledWith(
        'openai/gpt-oss-120b',
        'No endpoints found matching your data policy.',
        404,
      );
      error.mockRestore();
    });
  });
});

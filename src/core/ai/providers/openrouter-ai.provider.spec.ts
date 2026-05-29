import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { OpenRouterAiProvider } from './openrouter-ai.provider';

jest.mock('axios');

describe('OpenRouterAiProvider', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

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

    const config = {
      get: jest.fn((key: string) => {
        const values = {
          'ai.apiKey': 'secret',
          'ai.baseUrl': 'https://openrouter.ai/api/v1',
          'ai.model': 'openai/gpt-4o-mini',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    const provider = new OpenRouterAiProvider(config);
    const result = await provider.complete({
      conversationId: 'conversation-1',
      messages: [{ role: 'user', content: 'Oi' }],
      tools: [],
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        model: 'openai/gpt-4o-mini',
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
  });
});

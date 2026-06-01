import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AiModelSelectionService } from './ai-model-selection.service';

jest.mock('axios');

describe('AiModelSelectionService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  function makeService(existingSettings: Record<string, any> = {}) {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn(({ where }) => {
          const value = existingSettings[where.key];
          return Promise.resolve(value ? { key: where.key, value } : null);
        }),
        upsert: jest.fn(({ create, update }) =>
          Promise.resolve({ value: update?.value || create.value }),
        ),
      },
    };
    const config = {
      get: jest.fn((key: string) => {
        const values = {
          'ai.model': 'openai/gpt-oss-120b',
          'ai.apiKey': 'secret',
          'ai.baseUrl': 'https://openrouter.ai/api/v1',
          'ai.modelAutoSelectionEnabled': true,
          'ai.modelAllowlist': [
            'openai/gpt-oss-120b',
            'google/gemini-3.1-flash-lite',
            'qwen/qwen3.7-max',
          ],
          'ai.modelBlacklist': [],
          'ai.modelMinContext': 128000,
          'ai.modelSwitchMinGain': 0.15,
          'ai.modelSwitchCooldownDays': 7,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    return {
      service: new AiModelSelectionService(prisma as any, config),
      prisma,
    };
  }

  function model(id: string, overrides: Record<string, any> = {}) {
    return {
      id,
      name: id,
      context_length: 131000,
      supported_parameters: ['tools', 'tool_choice'],
      pricing: { prompt: '0.000000039', completion: '0.00000018' },
      architecture: { output_modalities: ['text'] },
      ...overrides,
    };
  }

  it('usa AI_MODEL como fallback quando não há configuração salva', async () => {
    const { service } = makeService();

    await expect(service.getActiveModel()).resolves.toBe('openai/gpt-oss-120b');
  });

  it('ignora modelos fora da allowlist ou sem tool_choice', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          model('openai/gpt-oss-120b'),
          model('unknown/model'),
          model('google/gemini-3.1-flash-lite', {
            supported_parameters: ['tools'],
          }),
        ],
      },
    });
    const { service } = makeService();

    const result = await service.evaluateAndMaybeSwitch('manual');

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe('openai/gpt-oss-120b');
  });

  it('troca para candidato permitido com melhor score e respeita persistência', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          model('openai/gpt-oss-120b', {
            pricing: { prompt: '0.000001', completion: '0.000004' },
          }),
          model('google/gemini-3.1-flash-lite', {
            pricing: { prompt: '0.00000003', completion: '0.00000008' },
          }),
        ],
      },
    });
    const { service, prisma } = makeService();

    const result = await service.evaluateAndMaybeSwitch('manual');

    expect(result.switched).toBe(true);
    expect(result.selectedModel).toBe('google/gemini-3.1-flash-lite');
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'ai_model_config' },
      }),
    );
  });

  it('não troca quando cooldown está ativo', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          model('openai/gpt-oss-120b', {
            pricing: { prompt: '0.000001', completion: '0.000004' },
          }),
          model('google/gemini-3.1-flash-lite', {
            pricing: { prompt: '0.00000003', completion: '0.00000008' },
          }),
        ],
      },
    });
    const { service } = makeService({
      ai_model_config: {
        activeModel: 'openai/gpt-oss-120b',
        autoSelectionEnabled: true,
        allowlist: ['openai/gpt-oss-120b', 'google/gemini-3.1-flash-lite'],
        blacklist: [],
        minContext: 128000,
        lastSwitchAt: new Date().toISOString(),
      },
    });

    const result = await service.evaluateAndMaybeSwitch('manual');

    expect(result.switched).toBe(false);
    expect(result.reason).toBe('Cooldown de troca ainda ativo.');
  });
});

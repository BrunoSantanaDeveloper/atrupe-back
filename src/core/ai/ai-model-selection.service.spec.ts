import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { AiModelSelectionService } from './ai-model-selection.service';

jest.mock('axios');

describe('AiModelSelectionService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  function makeService(
    existingSettings: Record<string, any> = {},
    configOverrides: Record<string, unknown> = {},
  ) {
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
          ...configOverrides,
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

  // A avaliação lê a lista de modelos e a de endpoints de retenção zero.
  // Sem a segunda lista informada, todo modelo tem retenção zero
  function mockOpenRouter(
    models: Array<{ id: string }>,
    zeroRetention: Array<{
      model_id: string;
      supported_parameters: string[];
    }> = models.map((item) => zdr(item.id)),
  ) {
    mockedAxios.get.mockReset();
    mockedAxios.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: {
          data: url.endsWith('/endpoints/zdr') ? zeroRetention : models,
        },
      }),
    );
  }

  function zdr(model_id: string, supported = ['tools', 'tool_choice']) {
    return { model_id, supported_parameters: supported };
  }

  it('usa AI_MODEL como fallback quando não há configuração salva', async () => {
    const { service } = makeService();

    await expect(service.getActiveModel()).resolves.toBe('openai/gpt-oss-120b');
  });

  it('ignora modelos fora da allowlist ou sem tool_choice', async () => {
    mockOpenRouter([
      model('openai/gpt-oss-120b'),
      model('unknown/model'),
      model('google/gemini-3.1-flash-lite', {
        supported_parameters: ['tools'],
      }),
    ]);
    const { service } = makeService();

    const result = await service.evaluateAndMaybeSwitch('manual');

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].id).toBe('openai/gpt-oss-120b');
  });

  it('troca para candidato permitido com melhor score e respeita persistência', async () => {
    mockOpenRouter([
      model('openai/gpt-oss-120b', {
        pricing: { prompt: '0.000001', completion: '0.000004' },
      }),
      model('google/gemini-3.1-flash-lite', {
        pricing: { prompt: '0.00000003', completion: '0.00000008' },
      }),
    ]);
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
    mockOpenRouter([
      model('openai/gpt-oss-120b', {
        pricing: { prompt: '0.000001', completion: '0.000004' },
      }),
      model('google/gemini-3.1-flash-lite', {
        pricing: { prompt: '0.00000003', completion: '0.00000008' },
      }),
    ]);
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

  describe('retenção zero', () => {
    const cheap = { prompt: '0.00000003', completion: '0.00000008' };
    const expensive = { prompt: '0.000001', completion: '0.000004' };
    const models = [
      model('openai/gpt-oss-120b', { pricing: expensive }),
      model('qwen/qwen3.7-max', { pricing: cheap }),
    ];

    it('modelo sem endpoint de retenção zero não é candidato, mesmo mais barato', async () => {
      mockOpenRouter(models, [zdr('openai/gpt-oss-120b')]);
      const { service } = makeService();

      const result = await service.evaluateAndMaybeSwitch('manual');

      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        'openai/gpt-oss-120b',
      ]);
      expect(result.candidates[0].reasons).toContain(
        'Tem provedor de retenção zero',
      );
      expect(result.switched).toBe(false);
    });

    it('endpoint de retenção zero que não aceita ferramentas não conta', async () => {
      mockOpenRouter(models, [
        zdr('openai/gpt-oss-120b'),
        zdr('qwen/qwen3.7-max', ['temperature']),
      ]);
      const { service } = makeService();

      const result = await service.evaluateAndMaybeSwitch('manual');

      expect(result.candidates.map((candidate) => candidate.id)).toEqual([
        'openai/gpt-oss-120b',
      ]);
    });

    it('modelo ativo sem retenção zero é trocado pelo melhor que tem', async () => {
      mockOpenRouter(models, [zdr('openai/gpt-oss-120b')]);
      const { service } = makeService({
        ai_model_config: {
          activeModel: 'qwen/qwen3.7-max',
          autoSelectionEnabled: true,
          allowlist: ['openai/gpt-oss-120b', 'qwen/qwen3.7-max'],
          blacklist: [],
          minContext: 128000,
        },
      });

      const result = await service.evaluateAndMaybeSwitch('scheduled');

      expect(result.switched).toBe(true);
      expect(result.selectedModel).toBe('openai/gpt-oss-120b');
    });

    it('com a política desligada, a lista não é consultada e o modelo volta a concorrer', async () => {
      mockOpenRouter(models, [zdr('openai/gpt-oss-120b')]);
      const { service } = makeService({}, { 'ai.zeroDataRetention': false });

      const result = await service.evaluateAndMaybeSwitch('manual');

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get.mock.calls[0][0]).toBe(
        'https://openrouter.ai/api/v1/models',
      );
      expect(result.selectedModel).toBe('qwen/qwen3.7-max');
      expect(result.candidates[0].reasons).not.toContain(
        'Tem provedor de retenção zero',
      );
    });
  });
});

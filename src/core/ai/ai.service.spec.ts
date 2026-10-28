import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AiSafetyService } from './ai-safety.service';
import { AiUsageService } from './ai-usage.service';

describe('AiService access control', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeService(
    enabled: boolean,
    options: {
      features?: Record<string, boolean>;
      limits?: Record<string, number>;
      used?: number;
    } = {},
  ) {
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
      },
      aiMessage: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiUsage: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.used === undefined ? null : { messages: options.used },
          ),
        upsert: jest
          .fn()
          .mockResolvedValue({ messages: (options.used ?? 0) + 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const settings = {
      isAiAccessEnabled: jest.fn().mockResolvedValue(enabled),
    };
    const planControl = {
      getCompanyPlanInfo: jest.fn().mockResolvedValue({
        features: options.features ?? { ai_assistant: true },
        limits: options.limits ?? { ai_messages_month: 300 },
      }),
      enforceFeature: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('fora do plano')),
    };
    const tools = {
      getDefinitions: jest.fn().mockReturnValue([]),
      execute: jest.fn(),
    };
    const provider = {
      complete: jest.fn().mockResolvedValue({
        content: 'Resposta',
        toolCalls: [],
        usage: { promptTokens: 1200, completionTokens: 300, costUsd: 0.0004 },
      }),
    };
    const usage = new AiUsageService(prisma as any);
    const service = new AiService(
      prisma as any,
      { get: jest.fn() } as any,
      new AiSafetyService(),
      tools as any,
      settings as any,
      provider as any,
      planControl as any,
      usage,
    );

    return { service, prisma, settings, planControl, tools, provider };
  }

  it('bloqueia listagem de conversas quando acesso global esta inativo', async () => {
    const { service, prisma } = makeService(false);

    await expect(service.listConversations(user)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(prisma.aiConversation.findMany).not.toHaveBeenCalled();
  });

  it('mantem listagem por usuario e empresa quando acesso global esta ativo', async () => {
    const { service, prisma, settings } = makeService(true);

    await expect(service.listConversations(user)).resolves.toEqual([]);
    expect(settings.isAiAccessEnabled).toHaveBeenCalled();
    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        userId: 'user-1',
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('plano sem ai_assistant: o chat recusa com o 403 do plano', async () => {
    const { service, provider, prisma } = makeService(true, { features: {} });

    await expect(
      service.chat({ message: 'Quanto vendi este mês?' }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });

  it('cota do mês no limite: 429 com a renovação, sem chegar ao provedor', async () => {
    const { service, provider, prisma } = makeService(true, { used: 300 });

    const error = await service
      .chat({ message: 'Quanto vendi este mês?' }, user)
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        code: 'AI_QUOTA_EXCEEDED',
        message: expect.stringMatching(
          /^Sua empresa usou as 300 mensagens do assistente deste mês\. A cota renova em \d{2}\/\d{2}\/\d{4}\.$/,
        ),
      }),
    );
    expect(provider.complete).not.toHaveBeenCalled();
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });

  it('a mensagem barrada pela proteção não conta na cota', async () => {
    const { service, provider, prisma } = makeService(true);

    const result = await service.chat(
      { message: 'Emita a nota do pedido 12' },
      user,
    );

    expect(result.message).toContain('Nota fiscal');
    expect(provider.complete).not.toHaveBeenCalled();
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it('pedido para montar orçamento não é barrado: vai ao modelo e conta', async () => {
    const { service, provider, prisma, tools } = makeService(true);

    await service.chat(
      {
        message:
          'Crie um orçamento de 200 placas 30x40 em PVC 3mm para a Clínica Sorriso',
      },
      user,
    );

    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(tools.getDefinitions).toHaveBeenCalledWith(
      new Set(['ai_assistant']),
    );
    // A mensagem conta e os tokens e o custo da chamada somam no mês
    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ messages: 1 }),
      }),
    );
    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          promptTokens: { increment: 1200 },
          completionTokens: { increment: 300 },
          costMicroUsd: { increment: 400 },
        },
      }),
    );
  });

  it('sem resposta do provedor, a mensagem é devolvida à cota', async () => {
    const { service, provider, prisma } = makeService(true);
    provider.complete.mockRejectedValue(
      new ServiceUnavailableException('indisponível'),
    );

    await expect(
      service.chat({ message: 'Quanto vendi este mês?' }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.aiUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { messages: { decrement: 1 } },
      }),
    );
  });

  describe('access-status', () => {
    it('chave global desligada: SYSTEM_OFF', async () => {
      const { service } = makeService(false);

      await expect(service.accessStatus(user)).resolves.toEqual(
        expect.objectContaining({ enabled: false, reason: 'SYSTEM_OFF' }),
      );
    });

    it('plano sem ai_assistant: NOT_IN_PLAN', async () => {
      const { service } = makeService(true, { features: {} });

      await expect(service.accessStatus(user)).resolves.toEqual(
        expect.objectContaining({ enabled: false, reason: 'NOT_IN_PLAN' }),
      );
    });

    it('cota estourada: QUOTA_EXCEEDED, com o uso e o limite', async () => {
      const { service } = makeService(true, { used: 300 });

      const status = await service.accessStatus(user);

      expect(status).toEqual(
        expect.objectContaining({ enabled: false, reason: 'QUOTA_EXCEEDED' }),
      );
      expect(status.quota).toEqual(
        expect.objectContaining({ used: 300, limit: 300 }),
      );
    });

    it('ligado: sem motivo, com a cota do mês', async () => {
      const { service } = makeService(true, { used: 12 });

      const status = await service.accessStatus(user);

      expect(status.enabled).toBe(true);
      expect(status.reason).toBeUndefined();
      expect(status.quota).toEqual({
        used: 12,
        limit: 300,
        renewsAt: expect.stringMatching(/^\d{4}-\d{2}-01T03:00:00\.000Z$/),
      });
    });
  });
});

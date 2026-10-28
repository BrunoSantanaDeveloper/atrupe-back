import { HttpException } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import {
  aiQuotaRenewsAt,
  aiUsageMonth,
  isAiUsageMonth,
} from './ai-usage-month';

describe('AiUsageService', () => {
  function makeService(messagesAfterIncrement = 1) {
    const prisma = {
      aiUsage: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          messages: messagesAfterIncrement,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return { service: new AiUsageService(prisma as any), prisma };
  }

  describe('o mês da cota', () => {
    it('vira no fuso de São Paulo, não no UTC', () => {
      // 01/11 às 02:00 UTC ainda é 31/10 às 23:00 em São Paulo
      expect(aiUsageMonth(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10');
      expect(aiUsageMonth(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11');
    });

    it('renova no dia 1º do mês seguinte, inclusive na virada do ano', () => {
      expect(aiQuotaRenewsAt('2026-10').toISOString()).toBe(
        '2026-11-01T03:00:00.000Z',
      );
      expect(aiQuotaRenewsAt('2026-12').toISOString()).toBe(
        '2027-01-01T03:00:00.000Z',
      );
    });

    it('aceita só AAAA-MM', () => {
      expect(isAiUsageMonth('2026-10')).toBe(true);
      expect(isAiUsageMonth('2026-13')).toBe(false);
      expect(isAiUsageMonth('2026-1')).toBe(false);
    });
  });

  it('dentro da cota: conta a mensagem e segue', async () => {
    const { service, prisma } = makeService(300);

    await service.reserveMessage('company-1', { ai_messages_month: 300 });

    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_month: { companyId: 'company-1', month: aiUsageMonth() },
        },
        create: expect.objectContaining({ messages: 1 }),
        update: { messages: { increment: 1 } },
      }),
    );
    expect(prisma.aiUsage.updateMany).not.toHaveBeenCalled();
  });

  it('duas mensagens na última vaga: a segunda volta e recebe o 429', async () => {
    const { service, prisma } = makeService(301);

    const error = await service
      .reserveMessage('company-1', { ai_messages_month: 300 })
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(prisma.aiUsage.updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        month: aiUsageMonth(),
        messages: { gt: 0 },
      },
      data: { messages: { decrement: 1 } },
    });
  });

  it('plano sem o limite, ou -1: sem cota', async () => {
    const { service, prisma } = makeService(5000);

    await service.reserveMessage('company-1', {});
    await service.reserveMessage('company-1', { ai_messages_month: -1 });

    expect(prisma.aiUsage.updateMany).not.toHaveBeenCalled();
    await expect(service.quota('company-1', {})).resolves.toEqual(
      expect.objectContaining({ limit: null }),
    );
  });

  it('primeira chamada do mês em paralelo: soma na linha que a outra criou', async () => {
    const { service, prisma } = makeService();
    prisma.aiUsage.upsert.mockRejectedValueOnce({ code: 'P2002' });
    prisma.aiUsage.update.mockResolvedValueOnce({ messages: 2 });

    await service.reserveMessage('company-1', { ai_messages_month: 300 });

    expect(prisma.aiUsage.update).toHaveBeenCalledWith({
      where: {
        companyId_month: { companyId: 'company-1', month: aiUsageMonth() },
      },
      data: { messages: { increment: 1 } },
    });
  });

  it('tokens e custo: o custo em milionésimos de dólar', async () => {
    const { service, prisma } = makeService();

    await service.recordTokens('company-1', {
      promptTokens: 2100,
      completionTokens: 450,
      costUsd: 0.00123,
    });

    expect(prisma.aiUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          promptTokens: { increment: 2100 },
          completionTokens: { increment: 450 },
          costMicroUsd: { increment: 1230 },
        },
      }),
    );
  });

  it('chamada sem consumo informado não grava nada', async () => {
    const { service, prisma } = makeService();

    await service.recordTokens('company-1', undefined);
    await service.recordTokens('company-1', {});

    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
  });

  it('consumo por empresa: custo em dólar e taxa de aplicação', async () => {
    const { service, prisma } = makeService();
    prisma.aiUsage.findMany.mockResolvedValue([
      {
        companyId: 'company-1',
        messages: 40,
        promptTokens: 80_000,
        completionTokens: 9_000,
        costMicroUsd: 52_000,
        actionsProposed: 8,
        actionsApplied: 6,
        company: { name: 'Gráfica Teste' },
      },
    ]);

    const result = await service.usageByCompany('2026-10');

    expect(result.companies).toEqual([
      expect.objectContaining({
        companyName: 'Gráfica Teste',
        costUsd: 0.052,
        applyRate: 0.75,
      }),
    ]);
    expect(result.totals).toEqual(
      expect.objectContaining({ companies: 1, messages: 40, costUsd: 0.052 }),
    );
  });
});

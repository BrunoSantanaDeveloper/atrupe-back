import { ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';

describe('AiService access control', () => {
  const user = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'role-1',
    isAdmin: false,
    isSystemAdmin: false,
  };

  function makeService(enabled: boolean) {
    const prisma = {
      aiConversation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const settings = {
      isAiAccessEnabled: jest.fn().mockResolvedValue(enabled),
    };
    const service = new AiService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      settings as any,
      {} as any,
    );

    return { service, prisma, settings };
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
});

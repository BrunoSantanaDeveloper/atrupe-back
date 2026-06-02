import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsService', () => {
  function makeService() {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    return {
      service: new SystemSettingsService(prisma as any),
      prisma,
    };
  }

  it('mantem acesso ao Assistente IA ativo quando configuracao ainda nao existe', async () => {
    const { service, prisma } = makeService();
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    await expect(service.getAiAccessConfig()).resolves.toEqual({
      enabled: true,
    });
  });

  it('retorna acesso inativo quando administrador desligou o agente', async () => {
    const { service, prisma } = makeService();
    prisma.systemSetting.findUnique.mockResolvedValue({
      key: 'ai_access_enabled',
      value: { enabled: false },
    });

    await expect(service.isAiAccessEnabled()).resolves.toBe(false);
  });

  it('persiste alteracao global de acesso ao agente', async () => {
    const { service, prisma } = makeService();
    prisma.systemSetting.upsert.mockResolvedValue({
      key: 'ai_access_enabled',
      value: { enabled: false },
    });

    await expect(service.updateAiAccessConfig(false)).resolves.toEqual({
      enabled: false,
    });
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'ai_access_enabled' },
      update: { value: { enabled: false } },
      create: {
        key: 'ai_access_enabled',
        value: { enabled: false },
      },
    });
  });
});

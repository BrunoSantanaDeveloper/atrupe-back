import { AtendimentoNumeroCron } from './atendimento-numero.cron';

const CONFIGURED = {
  CHATWOOT_URL: 'http://atendimento-chatwoot:3000',
  CHATWOOT_PLATFORM_TOKEN: 'token',
  SUPPORT_BOT_SECRET: 'segredo',
};

describe('AtendimentoNumeroCron', () => {
  const saved = { ...process.env };
  const silent = (cron: AtendimentoNumeroCron) => {
    const logger = (cron as any).logger;
    logger.log = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
    return logger;
  };
  const make = (
    checkWhatsapp: jest.Mock,
    extra: { syncWhatsappGroups?: jest.Mock; syncTeamGroups?: jest.Mock } = {},
  ) => {
    const service = {
      checkWhatsapp,
      syncWhatsappGroups:
        extra.syncWhatsappGroups ??
        jest.fn().mockResolvedValue({ skipped: 'no_unofficial' }),
      syncTeamGroups:
        extra.syncTeamGroups ??
        jest.fn().mockResolvedValue({
          skipped: 'no_groups',
          reopened: [],
          pruned: [],
        }),
    };
    const cron = new AtendimentoNumeroCron(service as any);
    return { cron, logger: silent(cron), service };
  };

  beforeEach(() => {
    Object.assign(process.env, CONFIGURED);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('confere a cada 15 minutos', () => {
    const metadata = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      AtendimentoNumeroCron.prototype.handleCron,
    );
    expect(metadata).toMatchObject({
      cronTime: '*/15 * * * *',
      name: 'atendimento-numero',
    });
  });

  it('sem o atendimento configurado neste ambiente, não faz nada', async () => {
    delete process.env.CHATWOOT_PLATFORM_TOKEN;
    const check = jest.fn();
    const { cron } = make(check);
    await cron.handleCron();
    expect(check).not.toHaveBeenCalled();
  });

  it('falha na conferência fica no log e não derruba a rotina', async () => {
    const check = jest.fn().mockRejectedValue(new Error('smtp fora'));
    const { cron, logger } = make(check);
    await expect(cron.handleCron()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('smtp fora'),
    );
  });

  it('na mesma volta confere os grupos; uma parte que falha não impede as outras', async () => {
    const check = jest.fn().mockRejectedValue(new Error('smtp fora'));
    const syncWhatsappGroups = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('fora'), { code: 'openwa_unreachable' }),
      );
    const syncTeamGroups = jest.fn().mockResolvedValue({
      skipped: null,
      reopened: ['g-1'],
      pruned: [],
    });
    const { cron, logger } = make(check, {
      syncWhatsappGroups,
      syncTeamGroups,
    });
    await cron.handleCron();
    expect(syncWhatsappGroups).toHaveBeenCalled();
    expect(syncTeamGroups).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('openwa_unreachable'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('1 reaberto(s)'),
    );
  });

  it('não sobrepõe duas conferências, e a seguinte roda depois da que falhou', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const check = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      )
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValue({ report: null, alerts: [] });
    const { cron } = make(check);

    const first = cron.handleCron();
    await cron.handleCron();
    expect(check).toHaveBeenCalledTimes(1);

    finish({ report: null, alerts: [] });
    await first;
    await cron.handleCron();
    await cron.handleCron();
    expect(check).toHaveBeenCalledTimes(3);
  });
});

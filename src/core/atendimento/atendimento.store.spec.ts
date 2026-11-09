import { AtendimentoStore } from './atendimento.store';

const alert = (overrides: Record<string, unknown> = {}) =>
  ({
    inbox_id: 5,
    route: 'nao_oficial',
    phone: '5548999990000',
    level: 'fora',
    kind: 'novo',
    since: '2026-11-08T15:00:00.000Z',
    fixBy: 'quem_conecta',
    title: 'O WhatsApp do atendimento parou',
    text: 'O WhatsApp do atendimento parou (5548999990000). O que fazer: ler o QR.',
    findings: [],
    ...overrides,
  }) as any;

function makeStore(
  people = [
    { email: 'ana@atrupe.com.br', name: 'Ana' },
    { email: 'bia@atrupe.com.br', name: 'Bia' },
  ],
) {
  const prisma = { user: { findMany: jest.fn(async () => people) } };
  const mail = {
    sendEmail: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const store = new AtendimentoStore(prisma as any, {} as any, mail as any);
  return { store, prisma, mail };
}

describe('AtendimentoStore.alertWhatsapp', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.APP_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.atrupe.com.br/';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('manda um e-mail a cada superadmin ativo, com o que fazer e o link da tela', async () => {
    const { store, prisma, mail } = makeStore();
    await store.alertWhatsapp('plataforma', [alert()]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        userRole: { some: { isSystemAdmin: true } },
      },
      select: { email: true, name: true },
    });
    expect(mail.sendEmail).toHaveBeenCalledTimes(2);
    expect(mail.sendEmail).toHaveBeenCalledWith(
      'ana@atrupe.com.br',
      'O WhatsApp do atendimento parou',
      'whatsapp-alert',
      {
        name: 'Ana',
        title: 'O WhatsApp do atendimento parou',
        text: alert().text,
        sinceText: expect.stringContaining('08/11/2026'),
        tecnico: false,
        panelUrl: 'https://app.atrupe.com.br/admin/atendimento/whatsapp',
      },
      [],
    );
  });

  it('diz quando a correção é no servidor', async () => {
    const { store, mail } = makeStore();
    await store.alertWhatsapp('plataforma', [alert({ fixBy: 'tecnico' })]);
    expect(mail.sendEmail.mock.calls[0][3]).toMatchObject({ tecnico: true });
  });

  it('quando volta ao normal, não fala em desde quando nem em servidor', async () => {
    const { store, mail } = makeStore();
    await store.alertWhatsapp('plataforma', [
      alert({
        kind: 'voltou',
        fixBy: 'tecnico',
        title: 'O WhatsApp do atendimento voltou ao normal',
      }),
    ]);
    expect(mail.sendEmail.mock.calls[0][3]).toMatchObject({
      sinceText: '',
      tecnico: false,
    });
  });

  it('o aviso do homolog não parece a produção fora do ar', async () => {
    process.env.APP_ENV = 'development';
    const { store, mail } = makeStore();
    await store.alertWhatsapp('plataforma', [alert()]);
    expect(mail.sendEmail.mock.calls[0][1]).toBe(
      '[Homolog] O WhatsApp do atendimento parou',
    );
  });

  it('se ninguém recebeu, lança para o aviso voltar na próxima conferência', async () => {
    const { store, mail } = makeStore();
    mail.sendEmail.mockRejectedValue(new Error('smtp fora'));
    await expect(store.alertWhatsapp('plataforma', [alert()])).rejects.toThrow(
      'nenhum dos 2 superadmin',
    );
  });

  it('um endereço recusado não faz repetir o aviso a todos a cada 15 minutos', async () => {
    const { store, mail } = makeStore();
    mail.sendEmail.mockImplementationOnce(async () => {
      throw new Error('550 recusado');
    });
    await expect(
      store.alertWhatsapp('plataforma', [alert()]),
    ).resolves.toBeUndefined();
    expect(mail.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('sem superadmin ativo, lança em vez de dar o aviso por entregue', async () => {
    const { store, mail } = makeStore([]);
    await expect(store.alertWhatsapp('plataforma', [alert()])).rejects.toThrow(
      'Nenhum superadmin ativo',
    );
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

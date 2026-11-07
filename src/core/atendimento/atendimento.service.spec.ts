import {
  AtendimentoNaoConfigurado,
  AtendimentoService,
} from './atendimento.service';
import type { AtendimentoKitSource } from './atendimento.service';
import type { AtendimentoPerson, AtendimentoStore } from './atendimento.store';
import type { AtendimentoTools } from './atendimento-tools';

const superadmin: AtendimentoPerson = {
  key: 'u-admin',
  email: 'admin@atrupe.com.br',
  name: 'Admin',
  isSuperadmin: true,
  isSupportStaff: true,
  canConfigure: false,
};
const outsider: AtendimentoPerson = {
  ...superadmin,
  key: 'u-cliente',
  isSuperadmin: false,
  isSupportStaff: false,
};

const ENV = {
  CHATWOOT_URL: 'http://chatwoot-rails:3000',
  CHATWOOT_PUBLIC_URL: 'https://atendimento.atrupe.com.br',
  CHATWOOT_PLATFORM_TOKEN: 'plat-token',
  SUPPORT_BOT_PUBLIC_URL: 'https://atendimento.atrupe.com.br/robo/chatwoot',
  SUPPORT_BOT_SECRET: 'segredo',
  SUPPORT_SERVICE_EMAIL_DOMAIN: 'atrupe.com.br',
};

function makeKit() {
  const provision = {
    provisionAccount: jest.fn(async ({ state }) => ({
      ...state,
      account_id: 7,
      bot_token: 'bot',
      bot_secret: 'bs',
    })),
    ensureStaffUser: jest.fn(async ({ state, person }) => ({
      state: { ...state, staff: { ...(state.staff ?? {}), [person.key]: 42 } },
      userId: 42,
    })),
    removeStaffUser: jest.fn(async ({ state, personKey }) => {
      const staff = { ...(state.staff ?? {}) };
      const removed = staff[personKey] ?? null;
      delete staff[personKey];
      return { state: { ...state, staff }, removed };
    }),
    syncStaff: jest.fn(),
    ssoUrl: jest.fn(async () => 'https://atendimento.atrupe.com.br/sso'),
    connectCloudApi: jest.fn(),
    connectOpenWA: jest.fn(),
    whatsappStatus: jest.fn(),
    conversationHistory: jest.fn(async () => []),
  };
  const settings = {
    defaultPlatformSettings: (brand: string) => ({
      mode: 'auto',
      brand,
      knowledge: [],
      tools_enabled: [],
    }),
    canEnterPanel: (_model: string, person: AtendimentoPerson) =>
      Boolean(person?.isSupportStaff || person?.isSuperadmin),
    editableGroups: () => ['apresentacao', 'aprendizado'],
    validateSettings: jest.fn((value: { mode?: string }) =>
      value?.mode ? [] : [{ field: 'mode', message: 'Escolha o modo.' }],
    ),
    knowledgeOwner: () => 'plataforma',
    botConfig: jest.fn(({ platform, tools, ai }) => ({
      mode: platform.mode,
      ai,
      tools: tools.filter((tool) =>
        (platform.tools_enabled ?? []).includes(tool.name),
      ),
    })),
  };
  const contract = {
    createToolRunner: jest.fn(
      (tools, { isEnabled }) =>
        async (name, payload) =>
          (await isEnabled(payload.account_id, name))
            ? tools.find((tool) => tool.name === name).run(payload)
            : { ok: false, code: 'tool_disabled' },
    ),
    handleBotRequest: jest.fn(),
  };
  const report = {
    summarizeGaps: jest.fn(() => [{ topic: 'nota', count: 1 }]),
    GAP_CATEGORIES: { nao_sei: 'Não soube' },
  };
  return { provision, settings, contract, report, phone: {} };
}

function makeStore(initial: Record<string, unknown> = {}) {
  const data: Record<string, any> = { state: null, platform: null, ...initial };
  const store = {
    findPerson: jest.fn(),
    loadState: jest.fn(async () => data.state),
    saveState: jest.fn(async (_tenant, state) => {
      data.state = state;
    }),
    tenantByAccount: jest.fn(async (accountId: number) =>
      data.state?.account_id === accountId ? 'plataforma' : null,
    ),
    loadPlatformSettings: jest.fn(async () => data.platform),
    savePlatformSettings: jest.fn(async (settings) => {
      data.platform = settings;
    }),
    listPanelPeople: jest.fn(async () => ['u-admin']),
    addSuggestions: jest.fn(),
    listSuggestions: jest.fn(async () => data.suggestions ?? []),
    takeSuggestion: jest.fn(async () => true),
    addEvent: jest.fn(),
    listEvents: jest.fn(async () => []),
  };
  return { store, data };
}

function makeService(options: { modelo?: string; store?: any } = {}) {
  const kit = makeKit();
  const { store, data } = options.store ?? makeStore();
  const source: AtendimentoKitSource = {
    load: async () => kit as any,
    escolhas: () => ({
      modelo: options.modelo ?? 'plataforma',
      chatwoot: { features_off: ['campaigns'] },
      robo: { nome: 'Assistente Atrupe' },
    }),
    defaultBase: () => ({
      version: 'Versão de 29/10/2026.',
      instructions:
        'Instruções para o atendente:\n- Responda só sobre o Atrupe.',
      knowledge: [
        {
          title: 'Setores',
          q: 'Setores — como criar setor',
          a: 'Onde fica: Configurações › Setores',
        },
      ],
    }),
  };
  const tools = {
    build: () => [
      {
        name: 'situacao_da_conta',
        description: 'Situação da conta',
        input_schema: { type: 'object', properties: {} },
        run: jest.fn(async () => ({ ok: true, plano: 'PRO' })),
      },
    ],
  } as unknown as AtendimentoTools;
  const service = new AtendimentoService(
    store as unknown as AtendimentoStore,
    tools,
    source,
  );
  return { service, kit, store, data };
}

describe('AtendimentoService', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  describe('contexto do robô', () => {
    it('só o superadmin lê a camada da plataforma', async () => {
      const { service } = makeService();
      const denied = await service.readSettings(outsider, 'plataforma');
      expect(denied.status).toBe(403);
      const allowed = await service.readSettings(superadmin, 'plataforma');
      expect(allowed.status).toBe(200);
      expect(allowed.body).toMatchObject({
        model: 'plataforma',
        tools: [
          { name: 'situacao_da_conta', description: 'Situação da conta' },
        ],
      });
    });

    it('sem nada salvo, parte da base de suporte, sugerindo, sem consultar contas e no horário da equipe', async () => {
      const { service } = makeService();
      const settings = await service.platformSettings();
      expect(settings).toMatchObject({
        brand: 'Atrupe',
        mode: 'sugestao',
        tools_enabled: [],
        instructions: expect.stringContaining('Responda só sobre o Atrupe'),
        knowledge: [
          {
            q: 'Setores — como criar setor',
            a: 'Onde fica: Configurações › Setores',
          },
        ],
      });
      expect(settings.hours.days.seg).toEqual([
        ['08:00', '12:00'],
        ['13:30', '18:00'],
      ]);
      expect(settings.hours.days.sab).toEqual([]);
    });

    it('importar a base mostra o resultado sem gravar e mantém o que veio das conversas', async () => {
      const { service, store } = makeService({
        store: makeStore({
          platform: {
            mode: 'auto',
            instructions: 'antigas',
            knowledge: [
              { q: 'Setores — antiga', a: 'velha' },
              { q: 'Como trocar a logo?', a: 'Aprovada da conversa.' },
            ],
          },
        }),
      });
      const markdown = [
        '# Base de suporte — Atrupe Start',
        '',
        'Versão de 07/11/2026.',
        '',
        '## Instruções para o atendente',
        '',
        '- Você é o atendente de suporte do **Atrupe Start**.',
        '',
        '## Empresa e sistema',
        '',
        '### Setores',
        '',
        '**Onde fica:** Configurações › Empresa e sistema › Setores',
        '',
        '**Perguntas que trazem aqui:** como criar setor; renomear setor',
        '',
        '### Padrão de medida',
        '',
        'Define as unidades.',
      ].join('\n');
      const answer = await service.importBase(superadmin, markdown);
      expect(answer.status).toBe(200);
      const body = answer.body as any;
      expect(body.summary).toEqual({
        version: 'Versão de 07/11/2026.',
        updated: 1,
        added: 1,
        kept: 1,
      });
      expect(body.settings.instructions).toContain(
        'Você é o atendente de suporte do Atrupe Start.',
      );
      expect(body.settings.knowledge).toEqual([
        {
          q: 'Setores — como criar setor; renomear setor',
          a: 'Onde fica: Configurações › Empresa e sistema › Setores',
        },
        { q: 'Como trocar a logo?', a: 'Aprovada da conversa.' },
        { q: 'Padrão de medida', a: 'Define as unidades.' },
      ]);
      expect(store.savePlatformSettings).not.toHaveBeenCalled();
    });

    it('importar a base é só do superadmin e recusa texto sem tópicos', async () => {
      const { service } = makeService();
      expect((await service.importBase(outsider, '### A\nB')).status).toBe(403);
      expect((await service.importBase(superadmin, 'texto solto')).status).toBe(
        422,
      );
    });

    it('não existe camada de cliente: o escopo cliente é recusado até para o superadmin', async () => {
      const { service, store } = makeService();
      const answer = await service.writeSettings(superadmin, 'cliente', {
        mode: 'auto',
      });
      expect(answer.status).toBe(403);
      expect(store.savePlatformSettings).not.toHaveBeenCalled();
    });

    it('quem não é superadmin não grava, mesmo mandando dados válidos', async () => {
      const { service, store } = makeService();
      const answer = await service.writeSettings(outsider, 'plataforma', {
        mode: 'auto',
      });
      expect(answer.status).toBe(403);
      expect(store.savePlatformSettings).not.toHaveBeenCalled();
    });

    it('valida com a regra da base antes de gravar', async () => {
      const { service, store, kit } = makeService();
      const bad = await service.writeSettings(superadmin, 'plataforma', {});
      expect(bad.status).toBe(422);
      expect(store.savePlatformSettings).not.toHaveBeenCalled();

      const good = await service.writeSettings(superadmin, 'plataforma', {
        mode: 'auto',
      });
      expect(good.status).toBe(200);
      expect(store.savePlatformSettings).toHaveBeenCalledWith({ mode: 'auto' });
      expect(kit.settings.validateSettings).toHaveBeenLastCalledWith(
        { mode: 'auto' },
        { declaredTools: ['situacao_da_conta'], scope: 'plataforma' },
      );
    });

    it('recusa escolhas.json com outro modelo', async () => {
      const { service } = makeService({ modelo: 'por-cliente' });
      await expect(
        service.readSettings(superadmin, 'plataforma'),
      ).rejects.toThrow('modelo "por-cliente"');
    });
  });

  describe('entrar no painel', () => {
    it('cria a conta e a pessoa e devolve o link de entrada', async () => {
      const { service, kit, data } = makeService();
      const answer = await service.enterPanel(superadmin);
      expect(answer).toEqual({
        status: 200,
        body: { url: 'https://atendimento.atrupe.com.br/sso' },
      });
      expect(kit.provision.provisionAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            serviceEmail: 'atendimento+plataforma@atrupe.com.br',
            botName: 'Assistente Atrupe',
            featuresOff: ['campaigns'],
          }),
        }),
      );
      expect(data.state.staff).toEqual({ 'u-admin': 42 });
    });

    it('quem não é da equipe é recusado e sai do Chatwoot se estava lá', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({
          state: { account_id: 7, staff: { 'u-cliente': 9 } },
        }),
      });
      const answer = await service.enterPanel(outsider);
      expect(answer.status).toBe(403);
      expect(kit.provision.removeStaffUser).toHaveBeenCalled();
      expect(data.state.staff).toEqual({});
      expect(kit.provision.ssoUrl).not.toHaveBeenCalled();
    });

    it('sem sessão, 401', async () => {
      const { service } = makeService();
      expect((await service.enterPanel(null)).status).toBe(401);
    });

    it('sem as variáveis do Chatwoot, avisa que não está configurado', async () => {
      delete process.env.CHATWOOT_PLATFORM_TOKEN;
      const { service } = makeService();
      await expect(service.enterPanel(superadmin)).rejects.toBeInstanceOf(
        AtendimentoNaoConfigurado,
      );
    });
  });

  describe('sugestões de conhecimento', () => {
    const pending = [
      {
        id: 's1',
        tenantId: 'plataforma',
        owner: 'plataforma',
        conversationId: 3,
        q: 'Como emitir NFS-e?',
        a: 'Em Nota fiscal > Emitir NFS-e.',
        why: 'repetiu',
        at: '2026-11-07T10:00:00.000Z',
      },
    ];

    it('aprovar põe a pergunta editada no conhecimento e tira da fila', async () => {
      const { service, store, data } = makeService({
        store: makeStore({
          platform: { mode: 'auto', knowledge: [] },
          suggestions: pending,
        }),
      });
      const answer = await service.decideSuggestion(superadmin, 's1', {
        decisao: 'aprovar',
        a: 'Em Nota fiscal › Emitir NFS-e, a partir da O.S.',
      });
      expect(answer.status).toBe(200);
      expect(data.platform.knowledge).toEqual([
        {
          q: 'Como emitir NFS-e?',
          a: 'Em Nota fiscal › Emitir NFS-e, a partir da O.S.',
        },
      ]);
      expect(store.takeSuggestion).toHaveBeenCalledWith('s1');
    });

    it('descartar só tira da fila', async () => {
      const { service, store } = makeService({
        store: makeStore({ suggestions: pending }),
      });
      const answer = await service.decideSuggestion(superadmin, 's1', {
        decisao: 'descartar',
      });
      expect(answer.status).toBe(200);
      expect(store.savePlatformSettings).not.toHaveBeenCalled();
      expect(store.takeSuggestion).toHaveBeenCalledWith('s1');
    });

    it('quem não é superadmin não vê nem decide', async () => {
      const { service, store } = makeService({
        store: makeStore({ suggestions: pending }),
      });
      expect(
        (await service.decideSuggestion(outsider, 's1', { decisao: 'aprovar' }))
          .status,
      ).toBe(404);
      expect(store.takeSuggestion).not.toHaveBeenCalled();
      expect(
        (await service.listSuggestions(outsider, 'plataforma')).status,
      ).toBe(403);
    });
  });

  describe('rotas do robô', () => {
    function botCall(service: AtendimentoService, kit: any) {
      kit.contract.handleBotRequest.mockImplementation(
        async (_request, handlers) => handlers,
      );
      return service.botHandler({
        method: 'GET',
        pathWithQuery: '/atendimento/robo/config?account_id=7',
        route: 'config',
        query: { account_id: '7' },
        rawBody: '',
        headers: {},
      }) as unknown as Promise<any>;
    }

    it('confere a assinatura com SUPPORT_BOT_SECRET e monta a configuração da conta do Atrupe', async () => {
      process.env.SUPPORT_AI_PROVIDER = 'openai';
      process.env.SUPPORT_AI_BASE_URL = 'https://openrouter.ai/api/v1';
      process.env.SUPPORT_AI_KEY_ENV = 'OPENROUTER_API_KEY';
      process.env.SUPPORT_AI_MODEL = 'anthropic/claude-sonnet';
      const { service, kit } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot', bot_secret: 'bs' },
          platform: { mode: 'auto', tools_enabled: ['situacao_da_conta'] },
        }),
      });
      const handlers = await botCall(service, kit);
      expect(handlers.secret).toBe('segredo');
      const config = await handlers.getConfig(7);
      expect(config).toMatchObject({
        mode: 'auto',
        ai: {
          provider: 'openai',
          base_url: 'https://openrouter.ai/api/v1',
          key_env: 'OPENROUTER_API_KEY',
          model: 'anthropic/claude-sonnet',
        },
      });
      expect(await handlers.getConfig(8)).toBeNull();
    });

    it('consulta desligada pelo superadmin não roda', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot' },
          platform: { mode: 'auto', tools_enabled: [] },
        }),
      });
      const handlers = await botCall(service, kit);
      expect(
        await handlers.runTool('situacao_da_conta', { account_id: 7 }),
      ).toEqual({ ok: false, code: 'tool_disabled' });
    });

    it('guarda passagens e sugestões só da conta do Atrupe', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot' },
          platform: { mode: 'auto', learning: { enabled: true } },
        }),
      });
      const handlers = await botCall(service, kit);
      await handlers.saveEvent(8, { category: 'nao_sei' });
      expect(store.addEvent).not.toHaveBeenCalled();
      await handlers.saveEvent(7, { category: 'nao_sei' });
      expect(store.addEvent).toHaveBeenCalledWith('plataforma', {
        category: 'nao_sei',
      });
      await handlers.saveSuggestions(7, {
        conversation_id: 3,
        at: '2026-11-07T10:00:00.000Z',
        suggestions: [{ q: 'P?', a: 'R.', why: 'w' }],
      });
      expect(store.addSuggestions).toHaveBeenCalledWith([
        expect.objectContaining({
          tenantId: 'plataforma',
          owner: 'plataforma',
          q: 'P?',
        }),
      ]);
    });

    it('com o aprendizado desligado, as sugestões não entram na fila', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot' },
          platform: { mode: 'auto', learning: { enabled: false } },
        }),
      });
      const handlers = await botCall(service, kit);
      await handlers.saveSuggestions(7, {
        conversation_id: 3,
        at: '2026-11-07T10:00:00.000Z',
        suggestions: [{ q: 'P?', a: 'R.', why: 'w' }],
      });
      expect(store.addSuggestions).not.toHaveBeenCalled();
    });
  });

  describe('conexão não oficial (OpenWA)', () => {
    beforeEach(() => {
      Object.assign(process.env, {
        OPENWA_URL: 'http://atendimento-openwa:2785',
        OPENWA_PUBLIC_URL: 'https://wa.atrupe.com.br',
        OPENWA_API_KEY: 'chave',
      });
    });

    it('cada conexão usa uma sessão nova, e o estado mostra o QR da última', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot', service_token: 's' },
        }),
      });
      const names: string[] = [];
      kit.provision.connectOpenWA.mockImplementation(
        async ({ state, input }) => {
          names.push(input.sessionName);
          return {
            state: {
              ...state,
              inboxes: [
                ...(state.inboxes ?? []),
                {
                  id: names.length,
                  route: 'nao_oficial',
                  session_id: `s${names.length}`,
                },
              ],
            },
          };
        },
      );
      kit.provision.whatsappStatus.mockResolvedValue({
        status: 'qr_ready',
        qrCode: 'data:image/png;base64,QR',
      });

      expect(
        (await service.connectWhatsapp(superadmin, { route: 'nao_oficial' }))
          .status,
      ).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await service.connectWhatsapp(superadmin, { route: 'nao_oficial' });

      expect(names).toHaveLength(2);
      expect(names[0]).not.toBe(names[1]);
      for (const name of names) {
        expect(name).toMatch(/^atendimento-plataforma-[a-z0-9]+$/);
        expect(name.length).toBeLessThanOrEqual(50);
      }
      expect(kit.provision.connectOpenWA).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            relayEmail: 'repasse+plataforma@atrupe.com.br',
            chatwootPublicUrl: 'https://atendimento.atrupe.com.br',
            openwaUrl: 'http://atendimento-openwa:2785',
            openwaPublicUrl: 'https://wa.atrupe.com.br',
          }),
        }),
      );

      const status = await service.whatsapp(superadmin);
      expect(status.body).toEqual({
        connected: false,
        route: 'nao_oficial',
        status: 'qr_ready',
        qrCode: 'data:image/png;base64,QR',
      });
      expect(kit.provision.whatsappStatus).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's2' }),
      );
      expect(data.state.inboxes).toHaveLength(2);
    });

    it('só o superadmin conecta o número', async () => {
      const { service, kit } = makeService();
      expect(
        (await service.connectWhatsapp(outsider, { route: 'nao_oficial' }))
          .status,
      ).toBe(403);
      expect(kit.provision.connectOpenWA).not.toHaveBeenCalled();
    });
  });

  it('a conferência diária usa os superadmins ativos como equipe', async () => {
    const { service, kit, store } = makeService({
      store: makeStore({ state: { account_id: 7, staff: { 'u-velho': 5 } } }),
    });
    kit.provision.syncStaff.mockResolvedValue({
      state: { account_id: 7, staff: {} },
      removed: [{ key: 'u-velho', user_id: 5 }],
      unknown: [],
      skipped: null,
    });
    const result = await service.syncPanelStaff();
    expect(kit.provision.syncStaff).toHaveBeenCalledWith(
      expect.objectContaining({ keepKeys: ['u-admin'] }),
    );
    expect(result.removed).toEqual([{ key: 'u-velho', user_id: 5 }]);
    expect(store.saveState).toHaveBeenCalledWith('plataforma', {
      account_id: 7,
      staff: {},
    });
  });
});

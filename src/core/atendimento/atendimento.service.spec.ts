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

/** Como a base: a caixa mais recente de cada rota, sem as que saíram, na ordem em que foram ligadas. */
function currentInboxes(state: any) {
  const active = (state?.inboxes ?? []).filter((inbox) => !inbox.retired_at);
  const latest = new Map();
  for (const inbox of active) latest.set(inbox.route, inbox);
  return active.filter((inbox) => latest.get(inbox.route) === inbox);
}

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
    reconnectOpenWA: jest.fn(),
    updateCloudApi: jest.fn(),
    // Como a base: só tira uma rota quando a outra continua de pé.
    retireWhatsappRoute: jest.fn(({ state, route }) => {
      const fail = (code: string, fix: string) =>
        Object.assign(new Error(code), { code, fix });
      const active = currentInboxes(state);
      if (!active.some((inbox) => inbox.route === route)) {
        throw fail('route_not_connected', 'Confira a rota.');
      }
      if (!active.some((inbox) => inbox.route !== route)) {
        throw fail('last_channel', 'Conecte o outro número antes.');
      }
      return {
        ...state,
        inboxes: state.inboxes.map((inbox) =>
          inbox.route === route && !inbox.retired_at
            ? { ...inbox, retired_at: '2026-11-21T12:00:00.000Z' }
            : inbox,
        ),
      };
    }),
    conversationHistory: jest.fn(async () => []),
    syncOpenWAGroups: jest.fn(async () => ({
      sessions: 1,
      changed: 1,
      renamed: 0,
      unread: 0,
    })),
    saveTeamGroup: jest.fn(async ({ state, group }) => ({
      state: {
        ...state,
        team_groups: {
          ...(state.team_groups ?? {}),
          [group.key]: {
            inbox_id: 30,
            contact_id: 31,
            conversation_id: 32,
            name: group.name,
            members: group.members,
            labels: group.labels,
            archived: false,
          },
        },
      },
      missing: [],
    })),
    archiveTeamGroup: jest.fn(async ({ state, key }) => ({
      state: {
        ...state,
        team_groups: {
          ...state.team_groups,
          [key]: { ...state.team_groups[key], members: [], archived: true },
        },
      },
      archived: true,
    })),
    syncTeamGroups: jest.fn(),
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
    groupSettings: jest.fn(({ platform }) => ({
      mode: platform?.groups?.mode ?? 'fora',
      call_words: platform?.groups?.call_words ?? [],
      team_id: null,
    })),
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
    mediaSupport: jest.fn(async () => ({ audio: false })),
  };
  const report = {
    summarizeGaps: jest.fn(() => [{ topic: 'nota', count: 1 }]),
    GAP_CATEGORIES: { nao_sei: 'Não soube' },
  };
  const health = {
    currentInboxes,
    checkWhatsappHealth: jest.fn(),
    healthAlerts: jest.fn(),
  };
  const phone = {
    samePhone: (a: string, b: string) =>
      a.replace(/\D/g, '') === b.replace(/\D/g, ''),
  };
  return { provision, settings, contract, report, health, phone };
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
    teamPeople: jest.fn(async () => [
      { key: 'u-admin', name: 'Admin', email: 'admin@atrupe.com.br' },
      { key: 'u-ana', name: 'Ana', email: 'ana@atrupe.com.br' },
    ]),
    alertWhatsapp: jest.fn(async () => undefined),
    addSuggestions: jest.fn(),
    listSuggestions: jest.fn(async () => data.suggestions ?? []),
    takeSuggestion: jest.fn(async () => true),
    addEvent: jest.fn(),
    listEvents: jest.fn(async () => []),
  };
  return { store, data };
}

function makeService(
  options: {
    modelo?: string;
    store?: any;
    chatwoot?: { features_off?: string[]; resolver_apos_horas?: number };
  } = {},
) {
  const kit = makeKit();
  const { store, data } = options.store ?? makeStore();
  const source: AtendimentoKitSource = {
    load: async () => kit as any,
    escolhas: () => ({
      modelo: options.modelo ?? 'plataforma',
      chatwoot: options.chatwoot ?? { features_off: ['campaigns'] },
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
    perfilDoContato: jest.fn(async () => ({
      profile: 'ativo',
      label: 'Cliente ativo',
      facts: { empresa: 'Gráfica Sol', etapa: 'Lite' },
    })),
  };
  const service = new AtendimentoService(
    store as unknown as AtendimentoStore,
    tools as unknown as AtendimentoTools,
    source,
  );
  return { service, kit, store, data, tools };
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

    it('a tela sabe se o robô ouve áudio, pelo /health dele', async () => {
      const { service, kit } = makeService();
      kit.settings.editableGroups = () => ['midia', 'aprendizado'];
      const answer = await service.readSettings(superadmin, 'plataforma');
      expect((answer.body as any).media).toEqual({ audio: false });
      expect(kit.contract.mediaSupport).toHaveBeenCalledWith({
        ai: expect.objectContaining({ provider: 'anthropic' }),
        botUrl: 'https://atendimento.atrupe.com.br/robo/chatwoot',
      });
    });

    it('sem o endereço do robô (homolog), a tela abre e não se sabe do áudio', async () => {
      delete process.env.SUPPORT_BOT_PUBLIC_URL;
      const { service, kit } = makeService();
      kit.settings.editableGroups = () => ['midia', 'aprendizado'];
      const answer = await service.readSettings(superadmin, 'plataforma');
      expect(answer.status).toBe(200);
      expect((answer.body as any).media).toEqual({ audio: null });
      expect(kit.contract.mediaSupport).not.toHaveBeenCalled();
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
        {
          declaredTools: ['situacao_da_conta'],
          declaredProfiles: expect.arrayContaining([
            expect.objectContaining({ key: 'novo_contato' }),
            expect.objectContaining({ key: 'cancelado' }),
          ]),
          scope: 'plataforma',
        },
      );
    });

    it('a tela recebe os seis perfis de quem escreve', async () => {
      const { service } = makeService();
      const answer = await service.readSettings(superadmin, 'plataforma');
      expect(
        (answer.body as any).profiles.map(
          (perfil: { key: string }) => perfil.key,
        ),
      ).toEqual([
        'novo_contato',
        'teste',
        'ativo',
        'inadimplente',
        'bloqueado',
        'cancelado',
      ]);
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

    it('as preferências do painel ficam com a base: a lista em "Todas" só na primeira entrada', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: { account_id: 7, staff: { 'u-admin': 42 } },
        }),
      });
      await service.enterPanel(superadmin);
      const [input] = kit.provision.ensureStaffUser.mock.calls[0];
      // Sem os dois campos, valem os padrões da base: o painel lateral a cada
      // entrada e o filtro inicial só para quem entra na equipe.
      expect(input).not.toHaveProperty('uiSettings');
      expect(input).not.toHaveProperty('initialUiSettings');
    });

    it('a conversa parada volta ao robô no tempo de escolhas.json (sem ele, o padrão da base)', async () => {
      const padrao = makeService();
      await padrao.service.enterPanel(superadmin);
      expect(
        padrao.kit.provision.provisionAccount.mock.calls[0][0].input
          .autoResolveHours,
      ).toBeUndefined();

      const escolhido = makeService({
        chatwoot: { features_off: [], resolver_apos_horas: 0 },
      });
      await escolhido.service.enterPanel(superadmin);
      expect(escolhido.kit.provision.provisionAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ autoResolveHours: 0 }),
        }),
      );
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

    it('a rota contact devolve o perfil da conta do Atrupe, com a conversa para a confirmação por código', async () => {
      const { service, kit, tools } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot', bot_secret: 'bs' },
        }),
      });
      const handlers = await botCall(service, kit);
      const payload = {
        account_id: 7,
        conversation_id: 3,
        inbox_id: 1,
        contact: {
          id: 1,
          name: 'Ana',
          phone: '+5547999990000',
          identifier: null,
        },
        previous_profile: null,
      };
      expect(await handlers.getContact(7, payload)).toEqual({
        profile: 'ativo',
        label: 'Cliente ativo',
        facts: { empresa: 'Gráfica Sol', etapa: 'Lite' },
      });
      expect(tools.perfilDoContato).toHaveBeenCalledWith(kit, payload.contact, {
        accountId: 7,
        conversationId: 3,
      });
      // Outra conta do Chatwoot não é do Atrupe.
      expect(
        await handlers.getContact(8, { ...payload, account_id: 8 }),
      ).toBeNull();
    });

    it('a configuração do robô leva os perfis declarados', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: { account_id: 7, bot_token: 'bot', bot_secret: 'bs' },
          platform: { mode: 'auto' },
        }),
      });
      await (await botCall(service, kit)).getConfig(7);
      expect(kit.settings.botConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          profiles: expect.arrayContaining([
            expect.objectContaining({
              key: 'teste',
              label: 'Cliente em teste',
            }),
          ]),
        }),
      );
    });

    it('na Anthropic, a parte fixa do prompt fica uma hora no cache (o ambiente pode voltar a 5 min)', async () => {
      const state = { account_id: 7, bot_token: 'bot', bot_secret: 'bs' };
      const padrao = makeService({
        store: makeStore({ state, platform: { mode: 'auto' } }),
      });
      const config = await (
        await botCall(padrao.service, padrao.kit)
      ).getConfig(7);
      expect(config.ai).toMatchObject({
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        cache_ttl: '1h',
      });

      process.env.SUPPORT_AI_CACHE_TTL = '5m';
      const curto = makeService({
        store: makeStore({ state, platform: { mode: 'auto' } }),
      });
      expect(
        (await (await botCall(curto.service, curto.kit)).getConfig(7)).ai,
      ).toMatchObject({ cache_ttl: '5m' });
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

  describe('conferência do número', () => {
    const report = {
      checked_at: '2026-11-08T12:00:00.000Z',
      level: 'fora',
      inboxes: [
        {
          inbox_id: 5,
          route: 'nao_oficial',
          phone: null,
          level: 'fora',
          findings: [{ code: 'numero_desconectado' }],
        },
      ],
    };
    const alert = { kind: 'novo', title: 'O WhatsApp do atendimento parou' };
    const unofficial = {
      account_id: 7,
      service_token: 's',
      inboxes: [{ id: 5, route: 'nao_oficial', session_id: 'sess-1' }],
    };

    it('sem número conectado, não confere nem avisa', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({ state: { account_id: 7 } }),
      });
      expect(await service.checkWhatsapp()).toEqual({
        skipped: 'no_inbox',
        report: null,
        alerts: [],
      });
      expect(kit.health.checkWhatsappHealth).not.toHaveBeenCalled();
      expect(store.alertWhatsapp).not.toHaveBeenCalled();
    });

    it('avisa e só depois grava a memória', async () => {
      const { service, kit, store, data } = makeService({
        store: makeStore({ state: unofficial }),
      });
      kit.health.checkWhatsappHealth.mockResolvedValue(report);
      kit.health.healthAlerts.mockReturnValue({
        alerts: [alert],
        health: { '5': { level: 'fora', open: true } },
      });
      const result = await service.checkWhatsapp();
      expect(result.alerts).toEqual([alert]);
      expect(store.alertWhatsapp).toHaveBeenCalledWith('plataforma', [alert]);
      expect(store.alertWhatsapp.mock.invocationCallOrder[0]).toBeLessThan(
        store.saveState.mock.invocationCallOrder[0],
      );
      expect(data.state.health).toEqual({ '5': { level: 'fora', open: true } });
    });

    it('se o e-mail falhar, não grava a memória: o aviso volta na próxima', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({ state: unofficial }),
      });
      kit.health.checkWhatsappHealth.mockResolvedValue(report);
      kit.health.healthAlerts.mockReturnValue({
        alerts: [alert],
        health: { '5': { level: 'fora', open: true } },
      });
      store.alertWhatsapp.mockRejectedValue(new Error('smtp fora'));
      await expect(service.checkWhatsapp()).rejects.toThrow('smtp fora');
      expect(store.saveState).not.toHaveBeenCalled();
    });

    it('sem mudança, não avisa nem grava', async () => {
      const health = { '5': { level: 'fora', open: true } };
      const { service, kit, store } = makeService({
        store: makeStore({ state: { ...unofficial, health } }),
      });
      kit.health.checkWhatsappHealth.mockResolvedValue(report);
      kit.health.healthAlerts.mockReturnValue({ alerts: [], health });
      await service.checkWhatsapp();
      expect(store.alertWhatsapp).not.toHaveBeenCalled();
      expect(store.saveState).not.toHaveBeenCalled();
    });

    it('não apaga um número conectado enquanto a conferência rodava', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({ state: unofficial }),
      });
      const newInbox = { id: 9, route: 'oficial', phone: '+5548999990000' };
      kit.health.checkWhatsappHealth.mockImplementation(async () => {
        data.state = {
          ...data.state,
          inboxes: [...data.state.inboxes, newInbox],
        };
        return report;
      });
      kit.health.healthAlerts.mockReturnValue({
        alerts: [],
        health: { '5': { level: 'fora', open: false } },
      });
      await service.checkWhatsapp();
      expect(data.state.inboxes).toContainEqual(newInbox);
      expect(data.state.health).toEqual({
        '5': { level: 'fora', open: false },
      });
    });

    it('sem as variáveis do OpenWA, a conferência roda e a base aponta o problema', async () => {
      delete process.env.OPENWA_URL;
      delete process.env.OPENWA_API_KEY;
      const { service, kit } = makeService({
        store: makeStore({ state: unofficial }),
      });
      kit.health.checkWhatsappHealth.mockResolvedValue(report);
      kit.health.healthAlerts.mockReturnValue({ alerts: [], health: {} });
      await service.checkWhatsapp();
      expect(kit.health.checkWhatsappHealth).toHaveBeenCalledWith(
        expect.objectContaining({ openwa: { url: '', apiKey: '' } }),
      );
    });

    it('a rota oficial não consulta o OpenWA e a tela mostra o que a conferência viu', async () => {
      const state = {
        account_id: 7,
        service_token: 's',
        inboxes: [{ id: 5, route: 'oficial', phone: '+5548999990000' }],
      };
      const { service, kit } = makeService({ store: makeStore({ state }) });
      const findings = [{ code: 'meta_recusou_token', level: 'fora' }];
      kit.health.checkWhatsappHealth.mockResolvedValue({
        level: 'fora',
        inboxes: [{ inbox_id: 5, level: 'fora', findings }],
      });
      const channel = {
        connected: false,
        route: 'oficial',
        status: null,
        qrCode: null,
        level: 'fora',
        findings,
      };
      expect((await service.whatsapp(superadmin)).body).toEqual({
        ...channel,
        channels: [{ ...channel, inbox_id: 5, phone: '+5548999990000' }],
      });
      kit.health.healthAlerts.mockReturnValue({ alerts: [], health: {} });
      await service.checkWhatsapp();
      expect(kit.health.checkWhatsappHealth).toHaveBeenLastCalledWith(
        expect.objectContaining({ openwa: null }),
      );
    });

    it('antes de conectar, a tela recebe nível nulo e lista vazia', async () => {
      const { service } = makeService({
        store: makeStore({ state: { account_id: 7 } }),
      });
      expect((await service.whatsapp(superadmin)).body).toEqual({
        connected: false,
        route: null,
        status: null,
        qrCode: null,
        level: null,
        findings: [],
        channels: [],
      });
    });
  });

  describe('os dois números ao mesmo tempo', () => {
    const both = {
      account_id: 7,
      service_token: 's',
      inboxes: [
        {
          id: 5,
          route: 'nao_oficial',
          session_id: 'sess-1',
          phone: '554792621081',
        },
        { id: 9, route: 'oficial', phone: '+5547999990000' },
      ],
    };

    beforeEach(() => {
      Object.assign(process.env, {
        OPENWA_URL: 'http://atendimento-openwa:2785',
        OPENWA_API_KEY: 'chave',
      });
    });

    it('a conferência olha os dois canais, e o WhatsApp Web continua com o OpenWA', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: both }),
      });
      kit.health.checkWhatsappHealth.mockResolvedValue({
        level: 'ok',
        inboxes: [],
      });
      kit.health.healthAlerts.mockReturnValue({ alerts: [], health: {} });
      await service.checkWhatsapp();
      expect(kit.health.checkWhatsappHealth).toHaveBeenCalledWith(
        expect.objectContaining({
          inboxes: both.inboxes,
          openwa: { url: 'http://atendimento-openwa:2785', apiKey: 'chave' },
        }),
      );
    });

    it('a tela recebe um bloco por canal; os campos de cima são do ligado por último', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: both }),
      });
      kit.provision.whatsappStatus.mockResolvedValue({
        status: 'disconnected',
        qrCode: null,
        level: 'fora',
        findings: [{ code: 'numero_desconectado' }],
      });
      kit.health.checkWhatsappHealth.mockResolvedValue({
        level: 'ok',
        inboxes: [{ inbox_id: 9, level: 'ok', findings: [] }],
      });
      const body = (await service.whatsapp(superadmin)).body as any;
      expect(body.channels).toEqual([
        {
          inbox_id: 5,
          route: 'nao_oficial',
          phone: '554792621081',
          connected: false,
          status: 'disconnected',
          qrCode: null,
          level: 'fora',
          findings: [{ code: 'numero_desconectado' }],
        },
        {
          inbox_id: 9,
          route: 'oficial',
          phone: '+5547999990000',
          connected: true,
          status: null,
          qrCode: null,
          level: 'ok',
          findings: [],
        },
      ]);
      expect(body).toMatchObject({ route: 'oficial', connected: true });
      expect(body).not.toHaveProperty('inbox_id');
      expect(kit.health.checkWhatsappHealth).toHaveBeenCalledWith(
        expect.objectContaining({ inboxes: [both.inboxes[1]] }),
      );
    });

    it('ler o QR de novo retoma o WhatsApp Web mesmo com o oficial ligado depois', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: both }),
      });
      kit.provision.reconnectOpenWA.mockResolvedValue({
        status: 'initializing',
      });
      expect((await service.reconnectWhatsapp(superadmin)).status).toBe(200);
      expect(kit.provision.reconnectOpenWA).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1' }),
      );
    });

    it('deixar de usar uma rota tira o número da tela e da conferência', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({ state: both }),
      });
      expect(await service.retireWhatsapp(superadmin, 'oficial')).toEqual({
        status: 200,
        body: { ok: true },
      });
      expect(data.state.inboxes[1].retired_at).toBeTruthy();
      expect(data.state.inboxes[0].retired_at).toBeUndefined();
      kit.health.checkWhatsappHealth.mockResolvedValue({
        level: 'ok',
        inboxes: [],
      });
      kit.health.healthAlerts.mockReturnValue({ alerts: [], health: {} });
      await service.checkWhatsapp();
      expect(kit.health.checkWhatsappHealth).toHaveBeenLastCalledWith(
        expect.objectContaining({ inboxes: [both.inboxes[0]] }),
      );
    });

    it('o único número não sai (409), e só o superadmin tira um número (403)', async () => {
      const single = { account_id: 7, inboxes: [both.inboxes[0]] };
      const { service, store } = makeService({
        store: makeStore({ state: single }),
      });
      const answer = await service.retireWhatsapp(superadmin, 'nao_oficial');
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ code: 'last_channel' });
      expect((await service.retireWhatsapp(outsider, 'oficial')).status).toBe(
        403,
      );
      expect(store.saveState).not.toHaveBeenCalled();
    });
  });

  describe('volta do número', () => {
    beforeEach(() => {
      Object.assign(process.env, {
        OPENWA_URL: 'http://atendimento-openwa:2785',
        OPENWA_API_KEY: 'chave',
      });
    });

    it('ler o QR de novo retoma a sessão da caixa, sem criar outra', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({
          state: {
            account_id: 7,
            inboxes: [{ id: 5, route: 'nao_oficial', session_id: 'sess-1' }],
          },
        }),
      });
      kit.provision.reconnectOpenWA.mockResolvedValue({
        status: 'initializing',
        started: true,
      });
      expect(await service.reconnectWhatsapp(superadmin)).toEqual({
        status: 200,
        body: { ok: true, status: 'initializing' },
      });
      expect(kit.provision.reconnectOpenWA).toHaveBeenCalledWith({
        openwaUrl: 'http://atendimento-openwa:2785',
        openwaApiKey: 'chave',
        sessionId: 'sess-1',
      });
      expect(kit.provision.connectOpenWA).not.toHaveBeenCalled();
      expect(store.saveState).not.toHaveBeenCalled();
    });

    it('sem sessão do WhatsApp Web para retomar, 409; sem ser superadmin, 403', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: { account_id: 7, inboxes: [{ id: 5, route: 'oficial' }] },
        }),
      });
      expect((await service.reconnectWhatsapp(superadmin)).status).toBe(409);
      expect((await service.reconnectWhatsapp(outsider)).status).toBe(403);
      expect(kit.provision.reconnectOpenWA).not.toHaveBeenCalled();
    });

    const cloud = {
      route: 'oficial',
      phoneNumber: '+55 48 99999-0000',
      phoneNumberId: '111111',
      businessAccountId: '222222',
      apiKey: 'token-novo-permanente',
    };

    it('o mesmo número pela API oficial troca o token na mesma caixa', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: {
            account_id: 7,
            bot_token: 'b',
            inboxes: [{ id: 5, route: 'oficial', phone: '+5548999990000' }],
          },
        }),
      });
      kit.provision.updateCloudApi.mockImplementation(async ({ state }) => ({
        state,
        metaWebhook: { callbackUrl: 'u', verifyToken: 'v' },
      }));
      const answer = await service.connectWhatsapp(superadmin, cloud);
      expect(answer.status).toBe(200);
      expect(kit.provision.updateCloudApi).toHaveBeenCalledWith(
        expect.objectContaining({ inboxId: 5 }),
      );
      expect(kit.provision.connectCloudApi).not.toHaveBeenCalled();
    });

    it('outro número pela API oficial cria outra caixa', async () => {
      const { service, kit } = makeService({
        store: makeStore({
          state: {
            account_id: 7,
            bot_token: 'b',
            inboxes: [{ id: 5, route: 'oficial', phone: '+5511888880000' }],
          },
        }),
      });
      kit.provision.connectCloudApi.mockImplementation(async ({ state }) => ({
        state,
        metaWebhook: { callbackUrl: 'u', verifyToken: 'v' },
      }));
      await service.connectWhatsapp(superadmin, cloud);
      expect(kit.provision.connectCloudApi).toHaveBeenCalledWith(
        expect.objectContaining({
          cloud: expect.objectContaining({ inboxName: 'WhatsApp oficial' }),
        }),
      );
      expect(kit.provision.updateCloudApi).not.toHaveBeenCalled();
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
            // Sem escolha sobre os grupos, eles ficam fora do painel.
            relayGroups: false,
          }),
        }),
      );

      const status = await service.whatsapp(superadmin);
      const channel = {
        connected: false,
        route: 'nao_oficial',
        status: 'qr_ready',
        qrCode: 'data:image/png;base64,QR',
      };
      // A caixa substituída na mesma rota não aparece: só a última.
      expect(status.body).toEqual({
        ...channel,
        channels: [{ ...channel, inbox_id: 2, phone: null }],
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

  describe('grupos do WhatsApp', () => {
    const conectado = {
      account_id: 7,
      service_token: 's',
      inboxes: [{ id: 1, route: 'nao_oficial', session_id: 's1' }],
    };
    beforeEach(() => {
      Object.assign(process.env, {
        OPENWA_URL: 'http://atendimento-openwa:2785',
        OPENWA_PUBLIC_URL: 'https://wa.atrupe.com.br',
        OPENWA_API_KEY: 'chave',
      });
    });

    it('mudar os grupos ao salvar leva a escolha ao OpenWA na hora', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: conectado, platform: { mode: 'auto' } }),
      });
      const answer = await service.writeSettings(superadmin, 'plataforma', {
        mode: 'auto',
        groups: { mode: 'equipe', call_words: [], team_id: null },
      });
      expect(answer).toEqual({ status: 200, body: { ok: true } });
      expect(kit.provision.syncOpenWAGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          relay: true,
          openwaUrl: 'http://atendimento-openwa:2785',
          state: conectado,
        }),
      );
    });

    it('salvar sem mexer nos grupos não chama o OpenWA', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: conectado, platform: { mode: 'auto' } }),
      });
      await service.writeSettings(superadmin, 'plataforma', {
        mode: 'sugestao',
      });
      expect(kit.provision.syncOpenWAGroups).not.toHaveBeenCalled();
    });

    it('com o OpenWA fora, salva e avisa que os grupos mudam na próxima conferência', async () => {
      const { service, kit, store } = makeService({
        store: makeStore({ state: conectado, platform: { mode: 'auto' } }),
      });
      kit.provision.syncOpenWAGroups.mockRejectedValue(
        Object.assign(new Error('fora'), { code: 'openwa_unreachable' }),
      );
      (service as any).logger.warn = jest.fn();
      const answer = await service.writeSettings(superadmin, 'plataforma', {
        mode: 'auto',
        groups: { mode: 'equipe', call_words: [], team_id: null },
      });
      expect(answer.status).toBe(200);
      expect((answer.body as any).aviso).toContain('próxima conferência');
      expect(store.savePlatformSettings).toHaveBeenCalled();
    });

    it('sem número pelo WhatsApp Web, a conferência dos grupos não faz nada', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: { account_id: 7, inboxes: [] } }),
      });
      expect(await service.syncWhatsappGroups()).toEqual({
        skipped: 'no_unofficial',
      });
      expect(kit.provision.syncOpenWAGroups).not.toHaveBeenCalled();
    });

    it('a conferência leva ao OpenWA o que a configuração diz (fora: desliga o repasse)', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: conectado, platform: { mode: 'auto' } }),
      });
      const result = await service.syncWhatsappGroups();
      expect(result).toMatchObject({ skipped: null, mode: 'fora' });
      expect(kit.provision.syncOpenWAGroups).toHaveBeenCalledWith(
        expect.objectContaining({ relay: false }),
      );
    });
  });

  describe('grupos da equipe', () => {
    const comGrupo = {
      account_id: 7,
      service_token: 's',
      staff: { 'u-admin': 42 },
      team_groups: {
        'g-1': {
          inbox_id: 30,
          contact_id: 31,
          conversation_id: 32,
          name: 'Financeiro',
          members: ['u-admin'],
          labels: ['cobranca'],
          archived: false,
        },
      },
    };

    it('só o superadmin vê, cria, muda e arquiva grupos', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: comGrupo }),
      });
      expect((await service.teamGroups(outsider)).status).toBe(403);
      expect(
        (await service.saveTeamGroup(outsider, { nome: 'X', membros: [] }))
          .status,
      ).toBe(403);
      expect((await service.archiveTeamGroup(outsider, 'g-1')).status).toBe(
        403,
      );
      expect(kit.provision.saveTeamGroup).not.toHaveBeenCalled();
      expect(kit.provision.archiveTeamGroup).not.toHaveBeenCalled();
    });

    it('lista os grupos e as pessoas que podem entrar neles', async () => {
      const { service } = makeService({
        store: makeStore({ state: comGrupo }),
      });
      const answer = await service.teamGroups(superadmin);
      expect(answer).toEqual({
        status: 200,
        body: {
          grupos: [
            {
              chave: 'g-1',
              nome: 'Financeiro',
              membros: ['u-admin'],
              etiquetas: ['cobranca'],
              arquivado: false,
            },
          ],
          pessoas: [
            { chave: 'u-admin', nome: 'Admin' },
            { chave: 'u-ana', nome: 'Ana' },
          ],
        },
      });
    });

    it('criar um grupo põe na equipe quem ainda não entrou e ignora quem não pode atender', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({
          state: {
            account_id: 7,
            service_token: 's',
            staff: { 'u-admin': 42 },
          },
        }),
      });
      const answer = await service.saveTeamGroup(superadmin, {
        nome: 'Suporte',
        membros: ['u-admin', 'u-ana', 'u-intruso'],
        etiquetas: ['urgente'],
      });
      expect(answer.status).toBe(200);
      const chave = (answer.body as any).chave;
      expect(chave).toMatch(/^g-[0-9a-f]{8}$/);
      // Só a Ana entra na equipe agora: o admin já estava, o intruso não atende.
      expect(kit.provision.ensureStaffUser).toHaveBeenCalledTimes(1);
      expect(kit.provision.ensureStaffUser).toHaveBeenCalledWith(
        expect.objectContaining({
          person: { key: 'u-ana', email: 'ana@atrupe.com.br', name: 'Ana' },
        }),
      );
      expect(kit.provision.saveTeamGroup).toHaveBeenCalledWith(
        expect.objectContaining({
          group: {
            key: chave,
            name: 'Suporte',
            members: ['u-admin', 'u-ana'],
            labels: ['urgente'],
          },
        }),
      );
      expect(data.state.team_groups[chave].members).toEqual([
        'u-admin',
        'u-ana',
      ]);
    });

    it('arquivar um grupo que não existe é 404; um que existe, arquiva', async () => {
      const { service, kit, data } = makeService({
        store: makeStore({ state: comGrupo }),
      });
      expect((await service.archiveTeamGroup(superadmin, 'g-9')).status).toBe(
        404,
      );
      expect((await service.archiveTeamGroup(superadmin, 'g-1')).status).toBe(
        200,
      );
      expect(kit.provision.archiveTeamGroup).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'g-1' }),
      );
      expect(data.state.team_groups['g-1'].archived).toBe(true);
    });

    it('a rotina tira dos grupos quem saiu da equipe, sem apagar o que mudou no meio-tempo', async () => {
      const { service, kit, store, data } = makeService({
        store: makeStore({
          state: {
            ...comGrupo,
            team_groups: {
              'g-1': {
                ...comGrupo.team_groups['g-1'],
                members: ['u-admin', 'u-saiu'],
              },
            },
          },
        }),
      });
      kit.provision.syncTeamGroups.mockImplementation(async ({ state }) => {
        // Enquanto o Chatwoot respondia, alguém conectou um número.
        data.state = {
          ...data.state,
          inboxes: [{ id: 1, route: 'nao_oficial' }],
        };
        return {
          state: {
            ...state,
            team_groups: {
              'g-1': { ...state.team_groups['g-1'], members: ['u-admin'] },
            },
          },
          reopened: ['g-1'],
          pruned: ['g-1'],
        };
      });
      const result = await service.syncTeamGroups();
      expect(result).toEqual({
        skipped: null,
        reopened: ['g-1'],
        pruned: ['g-1'],
      });
      expect(store.saveState).toHaveBeenCalledTimes(1);
      expect(data.state.inboxes).toEqual([{ id: 1, route: 'nao_oficial' }]);
      expect(data.state.team_groups['g-1'].members).toEqual(['u-admin']);
    });

    it('sem grupos, a rotina não chama o Chatwoot', async () => {
      const { service, kit } = makeService({
        store: makeStore({ state: { account_id: 7 } }),
      });
      expect(await service.syncTeamGroups()).toEqual({
        skipped: 'no_groups',
        reopened: [],
        pruned: [],
      });
      expect(kit.provision.syncTeamGroups).not.toHaveBeenCalled();
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

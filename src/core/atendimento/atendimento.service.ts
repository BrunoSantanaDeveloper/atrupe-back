import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AtendimentoEscolhas,
  AtendimentoKit,
  loadAtendimentoKit,
  readEscolhas,
} from './atendimento-kit';
import {
  ParsedSupportBase,
  TEAM_HOURS,
  applySupportBase,
  parseSupportBase,
  readDefaultSupportBase,
} from './atendimento-base-suporte';
import { AtendimentoTools } from './atendimento-tools';
import {
  AtendimentoPerson,
  AtendimentoStore,
  PLATFORM_TENANT,
} from './atendimento.store';

import type {
  BotRequest,
  ProjectTool,
} from '../../../atendimento/base/server/bot-contract.mjs';
import type { SupportState } from '../../../atendimento/base/server/provision.mjs';
import type {
  AiSettings,
  PlatformSettings,
  Scope,
} from '../../../atendimento/base/shared/settings.mjs';

/** Como o serviço obtém a base do kit e as escolhas; trocado nos testes. */
export const ATENDIMENTO_KIT = Symbol('ATENDIMENTO_KIT');
export interface AtendimentoKitSource {
  load(): Promise<AtendimentoKit>;
  escolhas(): AtendimentoEscolhas;
  /** A base de suporte que acompanha o código (atendimento/conhecimento). */
  defaultBase(): ParsedSupportBase | null;
}
export const defaultKitSource: AtendimentoKitSource = {
  load: loadAtendimentoKit,
  escolhas: readEscolhas,
  defaultBase: readDefaultSupportBase,
};

export interface Answer {
  status: number;
  body: unknown;
}

/** Falta configuração do atendimento neste ambiente (homolog, máquina local). */
export class AtendimentoNaoConfigurado extends Error {
  readonly code = 'nao_configurado';
  constructor(readonly missing: string) {
    super(`Falta a variável de ambiente ${missing} do atendimento.`);
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AtendimentoNaoConfigurado(name);
  return value;
}

/** Lidas na hora do uso: a API sobe sem elas e o resto do sistema segue. */
const env = {
  chatwootUrl: () => required('CHATWOOT_URL'),
  chatwootPublicUrl: () => required('CHATWOOT_PUBLIC_URL'),
  platformToken: () => required('CHATWOOT_PLATFORM_TOKEN'),
  botPublicUrl: () => required('SUPPORT_BOT_PUBLIC_URL'),
  botSecret: () => required('SUPPORT_BOT_SECRET'),
  serviceEmailDomain: () => required('SUPPORT_SERVICE_EMAIL_DOMAIN'),
  openwaUrl: () => required('OPENWA_URL'),
  openwaPublicUrl: () => required('OPENWA_PUBLIC_URL'),
  openwaApiKey: () => required('OPENWA_API_KEY'),
};

/** O atendimento está ligado neste ambiente (as variáveis do Chatwoot existem). */
export function atendimentoConfigurado(): boolean {
  return [
    'CHATWOOT_URL',
    'CHATWOOT_PLATFORM_TOKEN',
    'SUPPORT_BOT_SECRET',
  ].every((name) => Boolean(process.env[name]?.trim()));
}

/**
 * O provedor de IA padrão do robô. O kit sugere Anthropic; dá para trocar
 * pelo ambiente sem mexer no código, por exemplo para o OpenRouter:
 * SUPPORT_AI_PROVIDER=openai, SUPPORT_AI_BASE_URL=https://openrouter.ai/api/v1,
 * SUPPORT_AI_KEY_ENV=OPENROUTER_API_KEY e SUPPORT_AI_MODEL=<modelo>.
 */
function defaultAi(): Partial<AiSettings> {
  const provider = (process.env.SUPPORT_AI_PROVIDER?.trim() ||
    'anthropic') as AiSettings['provider'];
  const ai: Partial<AiSettings> = {
    provider,
    model:
      process.env.SUPPORT_AI_MODEL?.trim() ||
      (provider === 'anthropic' ? 'claude-opus-5-5' : null),
    effort:
      process.env.SUPPORT_AI_EFFORT?.trim() ||
      (provider === 'anthropic' ? 'low' : null),
  };
  if (process.env.SUPPORT_AI_BASE_URL?.trim()) {
    ai.base_url = process.env.SUPPORT_AI_BASE_URL.trim();
  }
  if (process.env.SUPPORT_AI_KEY_ENV?.trim()) {
    ai.key_env = process.env.SUPPORT_AI_KEY_ENV.trim();
  }
  return ai;
}

const forbidden = (message: string): Answer => ({
  status: 403,
  body: { code: 'forbidden', message },
});

/**
 * O atendimento do Atrupe pelo WhatsApp, no modelo "plataforma": o Atrupe
 * atende os próprios clientes, numa conta só do Chatwoot. O contexto do robô
 * (a camada da plataforma) só o superadmin lê e grava; a equipe que entra no
 * painel são os superadmins ativos.
 *
 * Porte de `atendimento/modelos/next/lib/atendimento.ts` do kit para o Nest:
 * a regra é a da base (`atendimento/base`), que não se edita.
 */
@Injectable()
export class AtendimentoService {
  private readonly logger = new Logger(AtendimentoService.name);
  private tools: Promise<ProjectTool[]> | null = null;

  constructor(
    private readonly store: AtendimentoStore,
    private readonly projectTools: AtendimentoTools,
    @Inject(ATENDIMENTO_KIT) private readonly source: AtendimentoKitSource,
  ) {}

  private async kit(): Promise<AtendimentoKit> {
    const modelo = this.source.escolhas().modelo;
    if (modelo !== 'plataforma') {
      throw new Error(
        `atendimento/escolhas.json está com o modelo "${modelo}"; esta ligação implementa só o modelo "plataforma".`,
      );
    }
    return this.source.load();
  }

  private declaredTools(): Promise<ProjectTool[]> {
    if (!this.tools) {
      this.tools = this.kit().then((kit) => this.projectTools.build(kit));
      this.tools.catch(() => (this.tools = null));
    }
    return this.tools;
  }

  person(userId: string): Promise<AtendimentoPerson | null> {
    return this.store.findPerson(userId);
  }

  /**
   * A camada da plataforma. Antes do primeiro salvamento, o ponto de partida
   * é a base de suporte que acompanha o código, com o horário da equipe.
   */
  async platformSettings(): Promise<PlatformSettings> {
    const saved = await this.store.loadPlatformSettings();
    if (saved) return saved;
    const kit = await this.kit();
    const base = this.source.defaultBase();
    return {
      ...kit.settings.defaultPlatformSettings('Atrupe'),
      // Começa sugerindo à equipe, sem responder sozinho: o superadmin passa
      // para "responder" quando o conhecimento estiver bom.
      mode: 'sugestao',
      instructions: base?.instructions ?? '',
      knowledge: (base?.knowledge ?? []).map(({ q, a }) => ({ q, a })),
      hours: TEAM_HOURS,
      // A base de suporte diz que o robô não acessa a conta do cliente:
      // nenhuma consulta ligada até o superadmin decidir o contrário.
      tools_enabled: [],
    };
  }

  /**
   * Uma versão nova da base de suporte (Markdown), aplicada sobre o contexto
   * atual sem gravar: a tela mostra o resultado e o superadmin salva.
   */
  async importBase(
    person: AtendimentoPerson | null,
    markdown: unknown,
  ): Promise<Answer> {
    if (!this.canEdit(person, 'plataforma')) {
      return forbidden('Você não pode mudar esta parte do robô.');
    }
    const text = typeof markdown === 'string' ? markdown : '';
    if (!text.trim() || text.length > 400_000) {
      return {
        status: 422,
        body: {
          code: 'invalid',
          message:
            'Envie o texto da base de suporte em Markdown (até 400 mil caracteres).',
        },
      };
    }
    const parsed = parseSupportBase(text);
    if (!parsed.knowledge.length) {
      return {
        status: 422,
        body: {
          code: 'invalid',
          message:
            'Não achei tópicos (títulos ###) na base. Confira se é o texto para o agente do WhatsApp.',
        },
      };
    }
    const kit = await this.kit();
    const { settings, summary } = applySupportBase(
      await this.platformSettings(),
      parsed,
    );
    const declared = (await this.declaredTools()).map((tool) => tool.name);
    const problems = kit.settings.validateSettings(settings, {
      declaredTools: declared,
      scope: 'plataforma',
    });
    if (problems.length) {
      return {
        status: 422,
        body: { code: 'invalid', message: problems[0].message, problems },
      };
    }
    return { status: 200, body: { settings, summary } };
  }

  /** Só o superadmin mexe na camada da plataforma; não há camada de cliente. */
  private canEdit(person: AtendimentoPerson | null, scope: Scope): boolean {
    return scope === 'plataforma' && Boolean(person?.isSuperadmin);
  }

  /** Cria, se faltar, a conta no Chatwoot, a conta de serviço e o robô. */
  async ensureAccount(): Promise<SupportState> {
    const kit = await this.kit();
    const escolhas = this.source.escolhas();
    const current = (await this.store.loadState(PLATFORM_TENANT)) ?? {};
    const next = await kit.provision.provisionAccount({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      state: current,
      input: {
        name: (await this.platformSettings()).brand || 'Suporte Atrupe',
        locale: 'pt_BR',
        featuresOff: escolhas.chatwoot?.features_off ?? [],
        serviceEmail: `atendimento+${PLATFORM_TENANT}@${env.serviceEmailDomain()}`,
        botName: escolhas.robo?.nome ?? 'Assistente virtual',
        botUrl: env.botPublicUrl(),
      },
    });
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      await this.store.saveState(PLATFORM_TENANT, next);
    }
    return next;
  }

  /** O link de entrada no painel, já logado (5 minutos, uso único). */
  async enterPanel(person: AtendimentoPerson | null): Promise<Answer> {
    if (!person) {
      return {
        status: 401,
        body: {
          code: 'unauthenticated',
          message: 'Entre no sistema para abrir o atendimento.',
        },
      };
    }
    const kit = await this.kit();
    if (!kit.settings.canEnterPanel('plataforma', person)) {
      // Quem perdeu o acesso e ainda estava na equipe sai do Chatwoot aqui;
      // se o Chatwoot não responder, a conferência diária tira depois.
      await this.removeFromPanel(person.key).catch(() => false);
      return {
        status: 403,
        body: {
          code: 'not_support_staff',
          message:
            'O atendimento é só para quem faz parte da equipe de atendimento.',
        },
      };
    }
    const state = await this.ensureAccount();
    const { state: next, userId } = await kit.provision.ensureStaffUser({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      state,
      person: { key: person.key, email: person.email, name: person.name },
    });
    await this.store.saveState(PLATFORM_TENANT, next);
    const url = await kit.provision.ssoUrl({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      userId,
    });
    return { status: 200, body: { url } };
  }

  /**
   * Tira a pessoa da equipe no Chatwoot; as conversas atribuídas a ela voltam
   * para a fila. Nunca tira a conta de serviço nem a de repasse.
   */
  async removeFromPanel(personKey: string): Promise<boolean> {
    const state = await this.store.loadState(PLATFORM_TENANT);
    if (!state?.staff?.[personKey]) return false;
    const kit = await this.kit();
    const { state: next, removed } = await kit.provision.removeStaffUser({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      state,
      personKey,
    });
    await this.store.saveState(PLATFORM_TENANT, next);
    return removed !== null;
  }

  /**
   * Conferência da equipe: tira do Chatwoot quem deixou de ser superadmin
   * ativo e aponta quem está na conta sem ter sido posto pelo sistema.
   */
  async syncPanelStaff() {
    const state = await this.store.loadState(PLATFORM_TENANT);
    if (!state?.account_id) {
      return { removed: [], unknown: [], skipped: 'no_account' as const };
    }
    const kit = await this.kit();
    const result = await kit.provision.syncStaff({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      state,
      keepKeys: await this.store.listPanelPeople(),
    });
    if (result.removed.length) {
      await this.store.saveState(PLATFORM_TENANT, result.state);
    }
    return {
      removed: result.removed,
      unknown: result.unknown,
      skipped: result.skipped,
    };
  }

  async readSettings(
    person: AtendimentoPerson | null,
    scope: Scope,
  ): Promise<Answer> {
    if (!this.canEdit(person, scope)) {
      return forbidden('Você não pode ver esta parte do robô.');
    }
    const kit = await this.kit();
    const [settings, tools] = await Promise.all([
      this.platformSettings(),
      this.declaredTools(),
    ]);
    return {
      status: 200,
      body: {
        model: 'plataforma',
        scope,
        settings,
        editable: kit.settings.editableGroups(scope, 'plataforma', settings),
        tools: tools.map(({ name, description }) => ({ name, description })),
      },
    };
  }

  async writeSettings(
    person: AtendimentoPerson | null,
    scope: Scope,
    incoming: unknown,
  ): Promise<Answer> {
    if (!this.canEdit(person, scope)) {
      return forbidden('Você não pode mudar esta parte do robô.');
    }
    const kit = await this.kit();
    const declared = (await this.declaredTools()).map((tool) => tool.name);
    const problems = kit.settings.validateSettings(incoming, {
      declaredTools: declared,
      scope,
    });
    if (problems.length) {
      return {
        status: 422,
        body: {
          code: 'invalid',
          message: 'Confira os campos marcados.',
          problems,
        },
      };
    }
    await this.store.savePlatformSettings(incoming as PlatformSettings);
    this.logger.log(`Camada da plataforma do robô salva por ${person.key}.`);
    return { status: 200, body: { ok: true } };
  }

  async listSuggestions(
    person: AtendimentoPerson | null,
    scope: Scope,
  ): Promise<Answer> {
    if (!this.canEdit(person, scope)) {
      return forbidden('Você não revisa estas sugestões.');
    }
    const items = await this.store.listSuggestions({ owner: 'plataforma' });
    return {
      status: 200,
      body: {
        suggestions: items.map(({ id, q, a, why, at }) => ({
          id,
          q,
          a,
          why,
          at,
          tenant: null,
        })),
      },
    };
  }

  /** Aprovar põe a pergunta e a resposta, com as edições, no conhecimento. */
  async decideSuggestion(
    person: AtendimentoPerson | null,
    id: string,
    body: { decisao?: string; q?: string; a?: string },
  ): Promise<Answer> {
    if (!['aprovar', 'descartar'].includes(String(body?.decisao))) {
      return {
        status: 400,
        body: {
          code: 'decision_missing',
          message: 'Escolha aprovar ou descartar.',
        },
      };
    }
    const pending = this.canEdit(person, 'plataforma')
      ? await this.store.listSuggestions({ owner: 'plataforma' })
      : [];
    const item = pending.find((suggestion) => suggestion.id === id);
    if (!item) {
      return {
        status: 404,
        body: { code: 'not_found', message: 'Esta sugestão não existe mais.' },
      };
    }
    if (body.decisao === 'aprovar') {
      const entry = {
        q: String(body.q ?? item.q).trim(),
        a: String(body.a ?? item.a).trim(),
      };
      if (!entry.q || !entry.a) {
        return {
          status: 422,
          body: {
            code: 'invalid',
            message: 'A pergunta e a resposta precisam de texto.',
          },
        };
      }
      const platform = await this.platformSettings();
      const next = {
        ...platform,
        knowledge: [...(platform.knowledge ?? []), entry],
      };
      const kit = await this.kit();
      const declared = (await this.declaredTools()).map((tool) => tool.name);
      const problems = kit.settings.validateSettings(next, {
        declaredTools: declared,
        scope: 'plataforma',
      });
      if (problems.length) {
        return {
          status: 422,
          body: {
            code: 'invalid',
            message: problems[0].message,
            problems,
          },
        };
      }
      await this.store.savePlatformSettings(next);
    }
    await this.store.takeSuggestion(id);
    return { status: 200, body: { ok: true } };
  }

  async gaps(
    person: AtendimentoPerson | null,
    scope: Scope,
    days: number,
  ): Promise<Answer> {
    if (!this.canEdit(person, scope)) {
      return forbidden('Você não vê este relatório.');
    }
    const kit = await this.kit();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const events = await this.store.listEvents({ since });
    return {
      status: 200,
      body: {
        groups: kit.report.summarizeGaps(events, { days }),
        categories: kit.report.GAP_CATEGORIES,
      },
    };
  }

  async whatsapp(person: AtendimentoPerson | null): Promise<Answer> {
    if (!person?.isSuperadmin) {
      return forbidden('Só quem administra o atendimento conecta o número.');
    }
    const state = (await this.store.loadState(PLATFORM_TENANT)) ?? {};
    const inbox = state.inboxes?.[state.inboxes.length - 1];
    if (!inbox) {
      return {
        status: 200,
        body: { connected: false, route: null, status: null, qrCode: null },
      };
    }
    if (inbox.route === 'oficial') {
      return {
        status: 200,
        body: {
          connected: true,
          route: 'oficial',
          status: 'ready',
          qrCode: null,
        },
      };
    }
    const kit = await this.kit();
    const status = await kit.provision.whatsappStatus({
      openwaUrl: env.openwaUrl(),
      openwaApiKey: env.openwaApiKey(),
      sessionId: inbox.session_id,
    });
    return {
      status: 200,
      body: {
        connected: status.status === 'ready',
        route: 'nao_oficial',
        ...status,
      },
    };
  }

  async connectWhatsapp(
    person: AtendimentoPerson | null,
    body: Record<string, string>,
  ): Promise<Answer> {
    if (!person?.isSuperadmin) {
      return forbidden('Você não pode conectar o número.');
    }
    if (!body || !['oficial', 'nao_oficial'].includes(body.route)) {
      return {
        status: 400,
        body: { code: 'route_missing', message: 'Escolha a forma de conexão.' },
      };
    }
    const kit = await this.kit();
    const state = await this.ensureAccount();
    if (body.route === 'oficial') {
      const result = await kit.provision.connectCloudApi({
        chatwootUrl: env.chatwootUrl(),
        state,
        cloud: {
          phoneNumber: body.phoneNumber,
          phoneNumberId: body.phoneNumberId,
          businessAccountId: body.businessAccountId,
          apiKey: body.apiKey,
        },
      });
      await this.store.saveState(PLATFORM_TENANT, result.state);
      return { status: 200, body: { metaWebhook: result.metaWebhook } };
    }
    const result = await kit.provision.connectOpenWA({
      chatwootUrl: env.chatwootUrl(),
      platformToken: env.platformToken(),
      state,
      input: {
        sessionName: `atendimento-${PLATFORM_TENANT}`,
        relayEmail: `repasse+${PLATFORM_TENANT}@${env.serviceEmailDomain()}`,
        chatwootPublicUrl: env.chatwootPublicUrl(),
        openwaUrl: env.openwaUrl(),
        openwaPublicUrl: env.openwaPublicUrl(),
        openwaApiKey: env.openwaApiKey(),
      },
    });
    await this.store.saveState(PLATFORM_TENANT, result.state);
    return { status: 200, body: { ok: true } };
  }

  /** A configuração que o robô recebe para uma conta do Chatwoot. */
  private async configFor(accountId: number) {
    const tenantId = await this.store.tenantByAccount(accountId);
    if (!tenantId) return null;
    const [state, platform, tools, kit] = await Promise.all([
      this.store.loadState(tenantId),
      this.platformSettings(),
      this.declaredTools(),
      this.kit(),
    ]);
    if (!state?.bot_token) return null;
    return {
      tenantId,
      config: kit.settings.botConfig({
        model: 'plataforma',
        platform,
        client: null,
        state,
        tools,
        ai: defaultAi(),
      }),
    };
  }

  /** As rotas que o robô chama, conferidas pela assinatura HMAC. */
  async botHandler(request: BotRequest): Promise<Answer> {
    const kit = await this.kit();
    const tools = await this.declaredTools();
    const runTool = kit.contract.createToolRunner(tools, {
      isEnabled: async (accountId, name) => {
        const found = await this.configFor(accountId);
        const enabled = found?.config.tools as
          | Array<{ name: string }>
          | undefined;
        return Boolean(enabled?.some((tool) => tool.name === name));
      },
    });
    return kit.contract.handleBotRequest(request, {
      secret: env.botSecret(),
      getConfig: async (accountId) =>
        (await this.configFor(accountId))?.config ?? null,
      runTool,
      getHistory: async (accountId, conversationId, limit) => {
        const tenantId = await this.store.tenantByAccount(accountId);
        const state = tenantId ? await this.store.loadState(tenantId) : null;
        if (!state) return [];
        return kit.provision.conversationHistory({
          chatwootUrl: env.chatwootUrl(),
          state,
          conversationId,
          limit,
        });
      },
      saveEvent: async (accountId, event) => {
        const tenantId = await this.store.tenantByAccount(accountId);
        if (tenantId) await this.store.addEvent(tenantId, event);
      },
      saveSuggestions: async (accountId, payload) => {
        const tenantId = await this.store.tenantByAccount(accountId);
        if (!tenantId) return;
        const platform = await this.platformSettings();
        if (platform.learning?.enabled === false) return;
        const owner = kit.settings.knowledgeOwner('plataforma', platform);
        await this.store.addSuggestions(
          (payload.suggestions ?? []).map((suggestion) => ({
            tenantId,
            owner,
            conversationId: payload.conversation_id,
            q: suggestion.q,
            a: suggestion.a,
            why: suggestion.why,
            at: payload.at,
          })),
        );
      },
    });
  }
}

import { AtendimentoTools, PERFIS_DECLARADOS } from './atendimento-tools';

const kit = {
  phone: {
    contactPhone: (contact: { phone_number?: string }) =>
      contact?.phone_number ? contact.phone_number.replace(/\D/g, '') : null,
    brPhoneVariants: (digits: string | null) => (digits ? [digits] : []),
  },
} as any;

const session = (overrides: Record<string, unknown> = {}) => ({
  plan: {
    name: 'PRO',
    active: true,
    trialEndsAt: null,
    features: [],
    limits: {},
  },
  blockLevel: 'NONE',
  billing: {
    situation: 'ATRASADA',
    daysOverdue: 3,
    paymentPending: false,
    activationPending: false,
    evolutionPending: false,
    chargeInFocus: {
      asaasPaymentId: 'pay_1',
      dueDate: '2026-11-04',
      value: 189.9,
      billingType: 'BOLETO',
      status: 'OVERDUE',
      invoiceUrl: 'https://www.asaas.com/i/abc',
    },
  },
  isOwner: false,
  ...overrides,
});

type Company = {
  id: string;
  name: string;
  legalName: string | null;
  isActive?: boolean;
  createdAt?: Date;
};

function makeTools({
  users = [] as Array<{ id: string; isActive?: boolean }>,
  companiesByUser = [] as Company[],
  companiesByPhone = [] as Array<{ id: string }>,
  companiesById = [] as Company[],
  canceledAt = null as Date | null,
  usersByEmail = [] as Array<{ id: string; name: string; email: string }>,
} = {}) {
  const queries: string[] = [];
  const settings = new Map<string, unknown>();
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(async ({ where }) =>
        settings.has(where.key) ? { value: settings.get(where.key) } : null,
      ),
      upsert: jest.fn(async ({ where, create }) => {
        settings.set(where.key, create.value);
      }),
    },
    user: {
      findFirst: jest.fn(
        async ({ where }) =>
          usersByEmail.find(
            (user) =>
              user.email.toLowerCase() === where.email.equals.toLowerCase(),
          ) ?? null,
      ),
    },
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const sql = strings.join('?');
        queries.push(sql);
        return sql.includes('"users"') ? users : companiesByPhone;
      },
    ),
    company: {
      findMany: jest.fn(async ({ where }) =>
        where.id ? companiesById : companiesByUser,
      ),
    },
    subscription: {
      findFirst: jest.fn(async () =>
        canceledAt ? { updatedAt: canceledAt } : null,
      ),
    },
  };
  const companySession = {
    buildWithGatewayCheck: jest.fn(async () => session()),
    build: jest.fn(async (_companyId: string) =>
      session({ blockLevel: 'PARTIAL' }),
    ),
  };
  const mail = { sendEmail: jest.fn(async (..._args: unknown[]) => undefined) };
  const tools = new AtendimentoTools(
    prisma as any,
    companySession as any,
    mail as any,
  );
  return { tools, prisma, companySession, queries, mail, settings };
}

const call = (
  input: Record<string, unknown> = {},
  phone = '+55 48 99999-0000',
) => ({
  accountId: 7,
  conversationId: 3,
  inboxId: 1,
  contact: {
    id: 1,
    name: 'Ana',
    phone_number: phone,
    identifier: null,
    email: null,
  },
  input,
});

describe('AtendimentoTools — situacao_da_conta', () => {
  it('declara a consulta com a descrição para a IA', () => {
    const { tools } = makeTools();
    const [tool] = tools.build(kit);
    expect(tool.name).toBe('situacao_da_conta');
    expect(tool.input_schema).toMatchObject({
      properties: { empresa: { type: 'string' } },
    });
  });

  it('sem telefone, não consulta nada', async () => {
    const { tools, prisma } = makeTools();
    const result = await tools.accountSituation(kit, call({}, ''));
    expect(result).toMatchObject({ ok: false, code: 'sem_telefone' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('devolve plano, bloqueio e a cobrança em aberto da empresa da pessoa', async () => {
    const { tools } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [{ id: 'c1', name: 'Gráfica Sol', legalName: null }],
    });
    const result = await tools.accountSituation(kit, call());
    expect(result).toEqual({
      ok: true,
      empresa: 'Gráfica Sol',
      plano: 'PRO',
      etapa: 'Pro',
      recurso_fiscal: false,
      cliente_desde: null,
      plano_ativo: true,
      teste_gratis_ate: null,
      bloqueio: 'nenhum',
      cobranca: 'atrasada',
      dias_em_atraso: 3,
      contratacao_aguardando_pagamento: false,
      mudanca_de_plano_aguardando_pagamento: false,
      cobranca_em_aberto: {
        vencimento: '2026-11-04',
        valor_reais: 189.9,
        forma: 'BOLETO',
        link_pagamento: 'https://www.asaas.com/i/abc',
      },
    });
  });

  it('o telefone casa só os dígitos, com e sem o 55', async () => {
    const { tools, prisma } = makeTools({ users: [{ id: 'u1' }] });
    await tools.accountSituation(kit, call());
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain(
      "regexp_replace(u.\"phone\", '\\D', '', 'g')",
    );
    expect(strings.join('?')).toContain("'55' || regexp_replace");
    expect(values[0]).toEqual(['5548999990000']);
  });

  it('telefone em mais de um usuário vai para a equipe', async () => {
    const { tools } = makeTools({ users: [{ id: 'u1' }, { id: 'u2' }] });
    expect(await tools.accountSituation(kit, call())).toMatchObject({
      ok: false,
      code: 'telefone_em_varios_usuarios',
    });
  });

  it('com mais de uma empresa, pergunta qual e aceita o nome sem acento', async () => {
    const companies = [
      { id: 'c1', name: 'Gráfica Sol', legalName: 'Sol Impressos LTDA' },
      { id: 'c2', name: 'Brindes Lua', legalName: null },
    ];
    const { tools, companySession } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: companies,
    });
    expect(await tools.accountSituation(kit, call())).toEqual({
      ok: false,
      code: 'varias_empresas',
      empresas: ['Gráfica Sol', 'Brindes Lua'],
    });
    const chosen = await tools.accountSituation(
      kit,
      call({ empresa: 'grafica' }),
    );
    expect(chosen).toMatchObject({ ok: true, empresa: 'Gráfica Sol' });
    expect(companySession.buildWithGatewayCheck).toHaveBeenCalledWith('c1');
    expect(
      await tools.accountSituation(kit, call({ empresa: 'padaria' })),
    ).toMatchObject({ ok: false, code: 'empresa_nao_encontrada' });
  });

  it('sem usuário com o telefone, procura a empresa com esse telefone', async () => {
    const { tools } = makeTools({
      users: [],
      companiesByPhone: [{ id: 'c9' }],
      companiesById: [{ id: 'c9', name: 'Copiadora Mar', legalName: null }],
    });
    expect(await tools.accountSituation(kit, call())).toMatchObject({
      ok: true,
      empresa: 'Copiadora Mar',
    });
  });

  it('telefone fora do cadastro', async () => {
    const { tools } = makeTools();
    expect(await tools.accountSituation(kit, call())).toMatchObject({
      ok: false,
      code: 'telefone_nao_cadastrado',
    });
  });

  it('se a conferência com o Asaas demora, responde com o banco', async () => {
    jest.useFakeTimers();
    try {
      const { tools, companySession } = makeTools({
        users: [{ id: 'u1' }],
        companiesByUser: [{ id: 'c1', name: 'Gráfica Sol', legalName: null }],
      });
      companySession.buildWithGatewayCheck.mockImplementation(
        () => new Promise(() => undefined),
      );
      const pending = tools.accountSituation(kit, call());
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await pending).toMatchObject({ ok: true, bloqueio: 'parcial' });
      expect(companySession.build).toHaveBeenCalledWith('c1');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AtendimentoTools — situacao_da_conta com empresa cancelada', () => {
  it('empresa desativada responde a situação, sem cobrança', async () => {
    const { tools, companySession } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [
        {
          id: 'c1',
          name: 'Gráfica Sol',
          legalName: null,
          isActive: false,
          createdAt: new Date('2025-12-05T12:00:00Z'),
        },
      ],
      canceledAt: new Date('2026-10-01T15:00:00Z'),
    });
    const result = await tools.accountSituation(kit, call());
    expect(result).toEqual({
      ok: true,
      empresa: 'Gráfica Sol',
      situacao: 'empresa cancelada',
      cliente_desde: '2025-12-05',
      cancelada_em: '2026-10-01',
    });
    expect(companySession.buildWithGatewayCheck).not.toHaveBeenCalled();
  });

  it('na lista de empresas, a cancelada vem marcada', async () => {
    const { tools } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [
        { id: 'c1', name: 'Gráfica Sol', legalName: null },
        { id: 'c2', name: 'Gráfica Lua', legalName: null, isActive: false },
      ],
    });
    const result = await tools.accountSituation(kit, call());
    expect(result).toMatchObject({
      code: 'varias_empresas',
      empresas: ['Gráfica Sol', 'Gráfica Lua (cancelada)'],
    });
  });

  it('usuário desativado só conta quando não há um ativo com o telefone', async () => {
    const ativoEInativo = makeTools({
      users: [
        { id: 'u1', isActive: true },
        { id: 'u2', isActive: false },
      ],
      companiesByUser: [{ id: 'c1', name: 'Gráfica Sol', legalName: null }],
    });
    expect(
      await ativoEInativo.tools.accountSituation(kit, call()),
    ).toMatchObject({ ok: true, empresa: 'Gráfica Sol' });
    const doisInativos = makeTools({
      users: [
        { id: 'u1', isActive: false },
        { id: 'u2', isActive: false },
      ],
    });
    expect(
      await doisInativos.tools.accountSituation(kit, call()),
    ).toMatchObject({ ok: false, code: 'telefone_em_varios_usuarios' });
  });
});

describe('AtendimentoTools — perfil de quem escreve', () => {
  const contato = (phone = '+55 47 99999-0000') => ({
    id: 1,
    name: 'Ana',
    phone,
    identifier: null,
  });
  const empresa = (extra: Partial<Company> = {}): Company => ({
    id: 'c1',
    name: 'Gráfica Sol',
    legalName: null,
    createdAt: new Date('2025-12-05T12:00:00Z'),
    ...extra,
  });
  const plano = (extra: Record<string, unknown>) => ({
    name: 'TRIAL',
    active: false,
    trialEndsAt: '2026-10-01T00:00:00.000Z',
    features: [],
    limits: {},
    ...extra,
  });

  it('declara os seis perfis com texto para a tela', () => {
    expect(PERFIS_DECLARADOS.map((perfil) => perfil.key)).toEqual([
      'novo_contato',
      'teste',
      'ativo',
      'inadimplente',
      'bloqueado',
      'cancelado',
    ]);
    for (const perfil of PERFIS_DECLARADOS) {
      expect(perfil.label).toBeTruthy();
      expect(perfil.description).toBeTruthy();
    }
  });

  it('telefone fora do cadastro é novo contato', async () => {
    const { tools } = makeTools();
    expect(await tools.perfilDoContato(kit, contato())).toEqual({
      profile: 'novo_contato',
      label: 'Novo contato',
    });
  });

  it('sem telefone ou com o telefone em mais de um usuário, fica sem perfil', async () => {
    const { tools } = makeTools();
    expect(await tools.perfilDoContato(kit, contato(''))).toEqual({
      profile: null,
    });
    const varios = makeTools({ users: [{ id: 'u1' }, { id: 'u2' }] });
    expect(await varios.tools.perfilDoContato(kit, contato())).toEqual({
      profile: null,
    });
  });

  it('aceita o telefone como o Chatwoot manda (phone_number)', async () => {
    const { tools, prisma } = makeTools();
    await tools.perfilDoContato(kit, { phone_number: '+55 47 99999-0000' });
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('empresa no teste grátis: perfil teste, com os dias que faltam', async () => {
    const { tools, companySession } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [empresa()],
    });
    const fim = new Date(Date.now() + 3.5 * 86_400_000);
    companySession.build.mockResolvedValue(
      session({ plan: plano({ trialEndsAt: fim.toISOString() }) }),
    );
    const result = await tools.perfilDoContato(kit, contato());
    expect(result).toMatchObject({
      profile: 'teste',
      label: 'Cliente em teste',
      facts: {
        empresa: 'Gráfica Sol',
        etapa: 'Teste',
        teste_dias_restantes: 4,
        cliente_desde: '2025-12-05',
      },
    });
    expect(companySession.buildWithGatewayCheck).not.toHaveBeenCalled();
  });

  it('teste vencido sem contratar e assinatura cancelada são cancelado', async () => {
    const vencido = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [empresa()],
    });
    vencido.companySession.build.mockResolvedValue(
      session({ plan: plano({}) }),
    );
    expect(await vencido.tools.perfilDoContato(kit, contato())).toMatchObject({
      profile: 'cancelado',
      facts: { situacao: 'teste grátis encerrado sem contratar' },
    });

    const cancelada = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [empresa()],
      canceledAt: new Date('2026-10-20T10:00:00Z'),
    });
    cancelada.companySession.build.mockResolvedValue(
      session({ plan: plano({}) }),
    );
    expect(await cancelada.tools.perfilDoContato(kit, contato())).toMatchObject(
      {
        profile: 'cancelado',
        facts: { situacao: 'assinatura cancelada', cancelada_em: '2026-10-20' },
      },
    );
  });

  it('empresa desativada é cancelado, sem montar a sessão', async () => {
    const { tools, companySession } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [empresa({ isActive: false })],
      canceledAt: new Date('2026-09-15T10:00:00Z'),
    });
    expect(await tools.perfilDoContato(kit, contato())).toMatchObject({
      profile: 'cancelado',
      facts: { situacao: 'empresa desativada', cancelada_em: '2026-09-15' },
    });
    expect(companySession.build).not.toHaveBeenCalled();
  });

  it.each([
    ['EM_DIA', 'NONE', 'ativo'],
    ['ATRASADA', 'NONE', 'inadimplente'],
    ['BLOQUEADA', 'PARTIAL', 'bloqueado'],
    ['INATIVA', 'FULL', 'bloqueado'],
  ])(
    'plano pago com cobrança %s (bloqueio %s) é %s',
    async (situation, blockLevel, perfil) => {
      const { tools, companySession } = makeTools({
        users: [{ id: 'u1' }],
        companiesByUser: [empresa()],
      });
      companySession.build.mockResolvedValue(
        session({
          blockLevel,
          plan: plano({
            name: 'LITE',
            active: true,
            trialEndsAt: null,
            features: ['nota_fiscal'],
          }),
          billing: {
            ...session().billing,
            situation,
            daysOverdue: situation === 'EM_DIA' ? 0 : 3,
          },
        }),
      );
      expect(await tools.perfilDoContato(kit, contato())).toMatchObject({
        profile: perfil,
        facts: { etapa: 'Lite', recurso_fiscal: true },
      });
    },
  );

  it('com mais de uma empresa, vale a de maior atenção e o robô pergunta qual', async () => {
    const { tools, companySession } = makeTools({
      users: [{ id: 'u1' }],
      companiesByUser: [
        empresa({ id: 'c1', name: 'Gráfica Sol' }),
        empresa({ id: 'c2', name: 'Gráfica Lua' }),
      ],
    });
    companySession.build.mockImplementation(async (id: string) =>
      id === 'c2'
        ? session({ billing: { ...session().billing, situation: 'ATRASADA' } })
        : session({
            billing: {
              ...session().billing,
              situation: 'EM_DIA',
              daysOverdue: 0,
            },
          }),
    );
    const result = await tools.perfilDoContato(kit, contato());
    expect(result).toMatchObject({
      profile: 'inadimplente',
      facts: {
        empresa: 'Gráfica Lua',
        empresas: 'Gráfica Sol; Gráfica Lua',
      },
    });
    expect(result.facts?.observacao).toContain('mais de uma empresa');
  });
});

describe('AtendimentoTools — confirmação por código de quem escreve de outro número', () => {
  const ana = { id: 'u9', name: 'Ana', email: 'ana@graficasol.com.br' };
  const codigoEnviado = (mail: { sendEmail: jest.Mock }) =>
    String(mail.sendEmail.mock.calls[0][3].code);

  it('declara as duas consultas, depois de situacao_da_conta', () => {
    const { tools } = makeTools();
    expect(tools.build(kit).map((tool) => tool.name)).toEqual([
      'situacao_da_conta',
      'confirmar_acesso',
      'validar_codigo',
    ]);
  });

  it('com ou sem cadastro, a resposta é a mesma; o código só vai a quem existe', async () => {
    const comCadastro = makeTools({ usersByEmail: [ana] });
    const semCadastro = makeTools();
    const a = await comCadastro.tools.confirmAccess(
      call({ email: ' Ana@GraficaSol.com.br ' }),
    );
    const b = await semCadastro.tools.confirmAccess(
      call({ email: 'ninguem@exemplo.com' }),
    );
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true });
    expect(comCadastro.mail.sendEmail).toHaveBeenCalledWith(
      'ana@graficasol.com.br',
      'Código para o atendimento do Atrupe',
      'atendimento-codigo',
      expect.objectContaining({ name: 'Ana', minutes: 10 }),
      [],
    );
    expect(codigoEnviado(comCadastro.mail)).toMatch(/^\d{6}$/);
    expect(semCadastro.mail.sendEmail).not.toHaveBeenCalled();
  });

  it('e-mail inválido e mais de 3 envios na hora são recusados', async () => {
    const { tools } = makeTools({ usersByEmail: [ana] });
    expect(await tools.confirmAccess(call({ email: 'ana' }))).toMatchObject({
      ok: false,
      code: 'email_invalido',
    });
    for (let i = 0; i < 3; i++) {
      await tools.confirmAccess(call({ email: ana.email }));
    }
    expect(await tools.confirmAccess(call({ email: ana.email }))).toMatchObject(
      { ok: false, code: 'muitos_envios' },
    );
  });

  it('o código certo liga a conversa à pessoa: consulta e perfil passam a usar a empresa dela', async () => {
    const { tools, mail, companySession } = makeTools({
      usersByEmail: [ana],
      companiesByUser: [
        {
          id: 'c1',
          name: 'Gráfica Sol',
          legalName: null,
          createdAt: new Date('2025-12-05T12:00:00Z'),
        },
      ],
    });
    // Antes da confirmação, o telefone não está no cadastro.
    expect(
      await tools.perfilDoContato(
        kit,
        { phone: '+55 47 98888-0000' },
        {
          accountId: 7,
          conversationId: 3,
        },
      ),
    ).toMatchObject({ profile: 'novo_contato' });

    await tools.confirmAccess(call({ email: ana.email }));
    const result = await tools.validateCode(
      call({ codigo: codigoEnviado(mail) }),
    );
    expect(result).toMatchObject({ ok: true, empresas: ['Gráfica Sol'] });

    companySession.build.mockResolvedValue(
      session({
        billing: { ...session().billing, situation: 'EM_DIA', daysOverdue: 0 },
      }),
    );
    expect(
      await tools.perfilDoContato(
        kit,
        { phone: '+55 47 98888-0000' },
        {
          accountId: 7,
          conversationId: 3,
        },
      ),
    ).toMatchObject({
      profile: 'ativo',
      facts: {
        empresa: 'Gráfica Sol',
        identificado_por: 'código enviado ao e-mail de acesso',
      },
    });
    expect(
      await tools.accountSituation(kit, call({}, '+55 47 98888-0000')),
    ).toMatchObject({ ok: true, empresa: 'Gráfica Sol' });
  });

  it('código errado conta tentativa; na quinta, esgota', async () => {
    const { tools, mail } = makeTools({ usersByEmail: [ana] });
    await tools.confirmAccess(call({ email: ana.email }));
    const certo = codigoEnviado(mail);
    const errado = certo === '000000' ? '111111' : '000000';
    for (let i = 4; i >= 0; i--) {
      expect(await tools.validateCode(call({ codigo: errado }))).toMatchObject({
        ok: false,
        code: 'codigo_errado',
        tentativas_restantes: i,
      });
    }
    expect(await tools.validateCode(call({ codigo: certo }))).toMatchObject({
      ok: false,
      code: 'tentativas_esgotadas',
    });
  });

  it('sem pedido ou com o código vencido, não confirma', async () => {
    const { tools, mail } = makeTools({ usersByEmail: [ana] });
    expect(await tools.validateCode(call({ codigo: '123456' }))).toMatchObject({
      ok: false,
      code: 'sem_codigo_valido',
    });
    await tools.confirmAccess(call({ email: ana.email }));
    const certo = codigoEnviado(mail);
    const agora = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(agora + 11 * 60_000);
    try {
      expect(await tools.validateCode(call({ codigo: certo }))).toMatchObject({
        ok: false,
        code: 'sem_codigo_valido',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('o código de uma conversa não vale em outra', async () => {
    const { tools, mail } = makeTools({ usersByEmail: [ana] });
    await tools.confirmAccess(call({ email: ana.email }));
    const outra = {
      ...call({ codigo: codigoEnviado(mail) }),
      conversationId: 4,
    };
    expect(await tools.validateCode(outra)).toMatchObject({
      ok: false,
      code: 'sem_codigo_valido',
    });
  });
});

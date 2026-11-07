import { AtendimentoTools } from './atendimento-tools';

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

function makeTools({
  users = [] as Array<{ id: string }>,
  companiesByUser = [] as Array<{
    id: string;
    name: string;
    legalName: string | null;
  }>,
  companiesByPhone = [] as Array<{ id: string }>,
  companiesById = [] as Array<{
    id: string;
    name: string;
    legalName: string | null;
  }>,
} = {}) {
  const queries: string[] = [];
  const prisma = {
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
  };
  const companySession = {
    buildWithGatewayCheck: jest.fn(async () => session()),
    build: jest.fn(async () => session({ blockLevel: 'PARTIAL' })),
  };
  const tools = new AtendimentoTools(prisma as any, companySession as any);
  return { tools, prisma, companySession, queries };
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

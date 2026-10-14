import { PLAN_FIXTURES } from './fixtures';
import { rolesForPlan } from './fixtures/roles';
import {
  fixtureKey,
  parseOptions,
  planRank,
  readSettings,
  retiredFixtureKey,
  TEST_PLAN_TYPES,
  testAccountEmail,
  testCompanyName,
} from './options';

describe('parseOptions', () => {
  it('por padrão garante todas as contas das duas famílias', () => {
    expect(parseOptions([])).toEqual({
      mode: 'garantir',
      dryRun: false,
      plans: ['TRIAL', 'START', 'LITE', 'PRO', 'ELITE', 'FULL'],
      families: ['demo', 'e2e'],
    });
    expect(parseOptions(['--garantir', '--dry-run'])).toMatchObject({
      mode: 'garantir',
      dryRun: true,
    });
  });

  it('aceita --planos nas duas formas, sem caixa, na ordem da trilha', () => {
    expect(parseOptions(['--planos', 'LITE,START']).plans).toEqual([
      'START',
      'LITE',
    ]);
    expect(parseOptions(['--planos=full,start,full']).plans).toEqual([
      'START',
      'FULL',
    ]);
  });

  it('recusa plano, família e opção desconhecidos', () => {
    expect(() => parseOptions(['--planos', 'START,GOLD'])).toThrow(/GOLD/);
    expect(() => parseOptions(['--planos'])).toThrow(/--planos/);
    expect(() => parseOptions(['--familias=demo,teste'])).toThrow(/teste/);
    expect(() => parseOptions(['--apagar-tudo'])).toThrow(/desconhecida/);
  });

  it('--refazer-dados vale só para a família e2e', () => {
    expect(parseOptions(['--refazer-dados'])).toMatchObject({
      mode: 'refazer-dados',
      families: ['e2e'],
    });
    expect(
      parseOptions(['--refazer-dados', '--familias', 'e2e']).families,
    ).toEqual(['e2e']);
    expect(() =>
      parseOptions(['--refazer-dados', '--familias', 'demo,e2e']),
    ).toThrow(/só vale para a família e2e/);
  });

  it('não mistura --garantir com --refazer-dados', () => {
    expect(() => parseOptions(['--garantir', '--refazer-dados'])).toThrow(
      /não os dois/,
    );
  });
});

describe('readSettings', () => {
  it('normaliza o domínio dos e-mails', () => {
    expect(
      readSettings({
        TEST_ACCOUNTS_EMAIL_DOMAIN: ' @Teste.Atrupe.com.br ',
        TEST_ACCOUNTS_PASSWORD: 'uma-senha-longa',
      }),
    ).toEqual({
      emailDomain: 'teste.atrupe.com.br',
      password: 'uma-senha-longa',
    });
  });

  it('exige as duas variáveis e diz quais faltam', () => {
    expect(() => readSettings({})).toThrow(
      /TEST_ACCOUNTS_EMAIL_DOMAIN não definida[\s\S]*TEST_ACCOUNTS_PASSWORD não definida/,
    );
  });

  it('recusa domínio inválido e senha curta sem repetir a senha', () => {
    let message = '';
    try {
      readSettings({
        TEST_ACCOUNTS_EMAIL_DOMAIN: 'localhost',
        TEST_ACCOUNTS_PASSWORD: 'curta1',
      });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/TEST_ACCOUNTS_EMAIL_DOMAIN inválido/);
    expect(message).toMatch(/pelo menos 8 caracteres/);
    expect(message).not.toContain('curta1');
  });
});

describe('nomes das contas', () => {
  it('monta o e-mail <cargo>.<família>-<plano>@<domínio>', () => {
    expect(testAccountEmail('admin', 'demo', 'START', 'teste.example')).toBe(
      'admin.demo-start@teste.example',
    );
    expect(testAccountEmail('vendedor', 'e2e', 'LITE', 'teste.example')).toBe(
      'vendedor.e2e-lite@teste.example',
    );
    expect(testAccountEmail('producao', 'e2e', 'FULL', 'teste.example')).toBe(
      'producao.e2e-full@teste.example',
    );
  });

  it('dá um e-mail diferente a cada conta e cargo', () => {
    const emails = new Set<string>();
    for (const family of ['demo', 'e2e'] as const) {
      for (const plan of TEST_PLAN_TYPES) {
        for (const cargo of [
          'admin',
          'vendedor',
          'producao',
          'caixa',
        ] as const) {
          emails.add(testAccountEmail(cargo, family, plan, 'teste.example'));
        }
      }
    }
    expect(emails.size).toBe(2 * TEST_PLAN_TYPES.length * 4);
  });

  it('marca a empresa com [TESTE], o plano e a família', () => {
    expect(testCompanyName('e2e', 'PRO')).toBe(
      '[TESTE] Comunicação Visual Pro (e2e)',
    );
  });

  it('códigos estáveis dos dados e o código de aposentado', () => {
    expect(fixtureKey('demo', 'cliente', '01')).toBe('demo:cliente:01');
    expect(
      retiredFixtureKey('e2e:cliente:01', new Date('2026-10-11T12:34:56.789Z')),
    ).toBe('e2e:cliente:01~refeito-20261011-123456');
  });
});

describe('fixtures', () => {
  it('o TRIAL vale como o START', () => {
    expect(planRank('TRIAL')).toBe(planRank('START'));
    expect(planRank('LITE')).toBeGreaterThan(planRank('START'));
  });

  it('Caixa e o usuário adicional só do LITE para cima', () => {
    for (const plan of TEST_PLAN_TYPES) {
      const fixture = PLAN_FIXTURES[plan];
      const fromLite = planRank(plan) >= planRank('LITE');
      expect(fixture.planType).toBe(plan);
      expect(fixture.additionalUsers).toBe(fromLite ? 1 : 0);
      expect(fixture.roles.map((role) => role.cargo)).toEqual(
        fromLite ? ['vendedor', 'producao', 'caixa'] : ['vendedor', 'producao'],
      );
    }
  });

  // O Vendedor vê valores (decisão do PO, 14/10); custo e precificação,
  // ninguém operacional
  it('nenhum cargo operacional vê custo ou precificação (SEG-6)', () => {
    for (const plan of TEST_PLAN_TYPES) {
      for (const role of rolesForPlan(plan)) {
        for (const permission of role.permissions) {
          expect(permission).toMatch(
            /^[a-z_]+:[a-z_]+:(view|create|edit|delete|export)$/,
          );
          expect(permission).not.toMatch(/^(cost|pricing):/);
          if (permission.startsWith('values:')) {
            expect(role.cargo).toBe('vendedor');
          }
        }
      }
    }
  });

  it('dados v1 em todas as contas: 8 clientes, 3 fornecedores, 3 orçamentos', () => {
    for (const plan of TEST_PLAN_TYPES) {
      const fixture = PLAN_FIXTURES[plan];
      expect(fixture.clients).toHaveLength(8);
      expect(fixture.suppliers).toHaveLength(3);
      expect(fixture.quotations).toHaveLength(3);

      const clientRefs = fixture.clients.map((client) => client.ref);
      expect(new Set(clientRefs).size).toBe(clientRefs.length);
      for (const quotation of fixture.quotations) {
        expect(clientRefs).toContain(quotation.clientRef);
      }
      // Fictício: nenhum e-mail fora do domínio reservado .example.
      for (const party of [...fixture.clients, ...fixture.suppliers]) {
        expect(party.email).toMatch(/\.example$/);
      }
    }
  });
});
